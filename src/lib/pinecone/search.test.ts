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

import { searchGameIds, searchGameHits, PineconeSearchError } from "./search";
import { PineconeIndexNotBootstrappedError } from "./client";

const ALL_RESULT_FIELDS = [
  "igdb_id",
  "schema_version",
  "slug",
  "name",
  "cover_image_id",
  "release_year",
  "genres",
  "platforms",
  "game_modes",
];

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

  it("passes the query and topK through to searchRecords, requesting v2-capable metadata fields including tags", async () => {
    mockSearchRecords.mockResolvedValue({ result: { hits: [] }, usage: {} });

    await searchGameIds("tactical rpg", 7);

    expect(mockSearchRecords).toHaveBeenCalledWith({
      query: { inputs: { text: "tactical rpg" }, topK: 7 },
      fields: ALL_RESULT_FIELDS,
    });
  });

  it("preserves every raw metadata field (e.g. schema_version) in the returned fields object — semantic-search.ts's pineconeCatalogueRecordSchema validation depends on this being the real, unmodified field set", async () => {
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          {
            _id: "igdb-303",
            _score: 0.7,
            fields: {
              igdb_id: 303,
              schema_version: 2,
              slug: "some-game",
              name: "Some Game",
              genres: ["RPG"],
              platforms: ["PC"],
              game_modes: ["Single player"],
            },
          },
        ],
      },
      usage: {},
    });

    const hits = await searchGameIds("query", 5);

    expect(hits[0]!.fields).toEqual({
      igdb_id: 303,
      schema_version: 2,
      slug: "some-game",
      name: "Some Game",
      genres: ["RPG"],
      platforms: ["PC"],
      game_modes: ["Single player"],
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

describe("searchGameHits", () => {
  it("returns the richer typed shape, including tags, for a well-formed hit", async () => {
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          {
            _id: "igdb-404",
            _score: 0.83,
            fields: {
              igdb_id: 404,
              schema_version: 2,
              slug: "stealth-game",
              name: "Stealth Game",
              cover_image_id: "abc123",
              release_year: 2021,
              genres: ["Shooter", "Adventure"],
              platforms: ["PC"],
              game_modes: ["Single player"],
            },
          },
        ],
      },
      usage: {},
    });

    const hits = await searchGameHits("stealth game", 10);

    expect(hits).toEqual([
      {
        recordId: "igdb-404",
        igdbId: 404,
        score: 0.83,
        slug: "stealth-game",
        name: "Stealth Game",
        coverImageId: "abc123",
        releaseYear: 2021,
        genres: ["Shooter", "Adventure"],
        platforms: ["PC"],
        gameModes: ["Single player"],
      },
    ]);
  });

  it("defaults missing optional fields (coverImageId/releaseYear) to null and missing tag arrays to []", async () => {
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          {
            _id: "igdb-505",
            _score: 0.4,
            fields: { igdb_id: 505, slug: "bare-game", name: "Bare Game" },
          },
        ],
      },
      usage: {},
    });

    const hits = await searchGameHits("query", 5);

    expect(hits).toEqual([
      {
        recordId: "igdb-505",
        igdbId: 505,
        score: 0.4,
        slug: "bare-game",
        name: "Bare Game",
        coverImageId: null,
        releaseYear: null,
        genres: [],
        platforms: [],
        gameModes: [],
      },
    ]);
  });

  it("drops a hit missing slug or name, unlike searchGameIds which only requires igdb_id", async () => {
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          { _id: "rec-a", _score: 0.9, fields: { igdb_id: 1 } },
          {
            _id: "rec-b",
            _score: 0.5,
            fields: { igdb_id: 2, slug: "only-slug" },
          },
          {
            _id: "rec-c",
            _score: 0.3,
            fields: { igdb_id: 3, slug: "full-record", name: "Full Record" },
          },
        ],
      },
      usage: {},
    });

    const hits = await searchGameHits("query", 5);

    expect(hits.map((h) => h.igdbId)).toEqual([3]);
  });

  it("propagates PineconeIndexUnavailableError and PineconeSearchError the same way searchGameIds does — shared underlying query", async () => {
    mockEnsureConfiguredIndex.mockRejectedValue(
      new PineconeIndexNotBootstrappedError(),
    );
    await expect(searchGameHits("query", 5)).rejects.toBeInstanceOf(
      PineconeIndexNotBootstrappedError,
    );

    mockEnsureConfiguredIndex.mockResolvedValue({
      searchRecords: mockSearchRecords,
    });
    mockSearchRecords.mockRejectedValue(new Error("network blip"));
    await expect(searchGameHits("query", 5)).rejects.toBeInstanceOf(
      PineconeSearchError,
    );
  });
});
