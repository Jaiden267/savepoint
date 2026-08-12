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
  it("returns hits in Pinecone's own order with game ids extracted from fields", async () => {
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          { _id: "rec-a", _score: 0.9, fields: { game_id: "game-a" } },
          { _id: "rec-b", _score: 0.5, fields: { game_id: "game-b" } },
        ],
      },
      usage: {},
    });

    const hits = await searchGameIds("cosy farming game", 5);

    expect(hits).toEqual([
      { gameId: "game-a", score: 0.9 },
      { gameId: "game-b", score: 0.5 },
    ]);
  });

  it("passes the query and topK through to searchRecords", async () => {
    mockSearchRecords.mockResolvedValue({ result: { hits: [] }, usage: {} });

    await searchGameIds("tactical rpg", 7);

    expect(mockSearchRecords).toHaveBeenCalledWith({
      query: { inputs: { text: "tactical rpg" }, topK: 7 },
      fields: ["game_id"],
    });
  });

  it("drops hits whose fields are missing a string game_id", async () => {
    mockSearchRecords.mockResolvedValue({
      result: {
        hits: [
          { _id: "rec-a", _score: 0.9, fields: {} },
          { _id: "rec-b", _score: 0.5, fields: { game_id: "game-b" } },
        ],
      },
      usage: {},
    });

    const hits = await searchGameIds("query", 5);

    expect(hits).toEqual([{ gameId: "game-b", score: 0.5 }]);
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
