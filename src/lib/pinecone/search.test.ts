import { describe, it, expect, vi, beforeEach } from "vitest";

// This suite never mocks any Supabase module — search.ts has no Supabase
// dependency at all, only Pinecone. If it ever gained one, an unmocked
// `createClient`/`createAdminClient` import would throw at test collection
// time and fail this file outright.

const { mockEnsureConfiguredIndex, mockSearchRecords } = vi.hoisted(() => ({
  mockEnsureConfiguredIndex: vi.fn(),
  mockSearchRecords: vi.fn(),
}));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, ensureConfiguredIndex: mockEnsureConfiguredIndex };
});

import { searchGameIds, PineconeSearchError } from "./search";
import { PineconeIndexNotBootstrappedError } from "./client";

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureConfiguredIndex.mockResolvedValue({
    searchRecords: mockSearchRecords,
  });
});

describe("searchGameIds", () => {
  it("returns hits in Pinecone's own order, keyed by igdb_id — never the record's own top-level id", async () => {
    // The record `_id` here is deliberately a raw Supabase-UUID-shaped
    // string for one hit and an `igdb-*`-shaped one for the other,
    // mirroring a real mixed v1/v2 index — searchGameIds must never read
    // `_id` for anything, only `fields.igdb_id`, which is present and a
    // plain number on both schema versions.
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          {
            _id: "3f1b1a4e-6b6b-4b1a-8b1a-6b6b4b1a8b1a",
            _score: 0.9,
            fields: { igdb_id: 101, schema_version: undefined },
          },
          {
            _id: "igdb-202",
            _score: 0.5,
            fields: { igdb_id: 202, schema_version: 2 },
          },
        ],
      },
      usage: {},
    });

    const hits = await searchGameIds("cosy farming game", 5);

    expect(hits).toEqual([
      {
        igdbId: 101,
        score: 0.9,
        fields: { igdb_id: 101, schema_version: undefined },
      },
      {
        igdbId: 202,
        score: 0.5,
        fields: { igdb_id: 202, schema_version: 2 },
      },
    ]);
  });

  it("passes the query and topK through to searchRecords, requesting v2-capable metadata fields", async () => {
    mockSearchRecords.mockResolvedValue({ result: { hits: [] }, usage: {} });

    await searchGameIds("tactical rpg", 7);

    expect(mockSearchRecords).toHaveBeenCalledWith({
      query: { inputs: { text: "tactical rpg" }, topK: 7 },
      fields: [
        "igdb_id",
        "schema_version",
        "slug",
        "name",
        "cover_image_id",
        "release_year",
      ],
    });
  });

  it("drops hits whose fields are missing a numeric igdb_id", async () => {
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          { _id: "rec-a", _score: 0.9, fields: {} },
          { _id: "rec-b", _score: 0.5, fields: { igdb_id: 202 } },
        ],
      },
      usage: {},
    });

    const hits = await searchGameIds("query", 5);

    expect(hits).toEqual([
      { igdbId: 202, score: 0.5, fields: { igdb_id: 202 } },
    ]);
  });

  it("propagates PineconeIndexUnavailableError from ensureConfiguredIndex as-is", async () => {
    mockEnsureConfiguredIndex.mockRejectedValue(
      new PineconeIndexNotBootstrappedError(),
    );

    await expect(searchGameIds("query", 5)).rejects.toBeInstanceOf(
      PineconeIndexNotBootstrappedError,
    );
  });

  it("wraps a searchRecords failure in PineconeSearchError", async () => {
    mockSearchRecords.mockRejectedValue(new Error("network blip"));

    await expect(searchGameIds("query", 5)).rejects.toBeInstanceOf(
      PineconeSearchError,
    );
  });
});
