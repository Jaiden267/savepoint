import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

const { mockSearchGameIds, mockSearchLocalGames } = vi.hoisted(() => ({
  mockSearchGameIds: vi.fn(),
  mockSearchLocalGames: vi.fn(),
}));

vi.mock("@/lib/pinecone/search", () => ({
  searchGameIds: mockSearchGameIds,
  PineconeSearchError: class PineconeSearchError extends Error {},
}));

vi.mock("@/server/services/game-catalogue", () => ({
  searchLocalGames: mockSearchLocalGames,
  toSearchResult: (row: {
    igdb_id: number;
    slug: string;
    name: string;
    cover_image_id: string | null;
    release_date: string | null;
  }) => ({
    source: "local",
    igdbId: row.igdb_id,
    slug: row.slug,
    name: row.name,
    coverImageId: row.cover_image_id,
    releaseYear: null,
    gameType: null,
    versionParentIgdbId: null,
  }),
}));

import { searchGamesSemantic } from "./semantic-search";
import { PineconeIndexUnavailableError } from "@/lib/pinecone/client";

interface ChainResult {
  data: unknown;
}

function makeSupabaseStub(result: ChainResult) {
  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain) } as unknown as Parameters<
    typeof searchGamesSemantic
  >[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockSearchLocalGames.mockResolvedValue([{ slug: "fallback-game" }]);
});

describe("searchGamesSemantic", () => {
  it("degrades to lexical fallback, without calling Pinecone, once the per-client rate limit is exceeded", async () => {
    mockSearchGameIds.mockResolvedValue([]);
    const supabase = makeSupabaseStub({ data: [] });
    for (let i = 0; i < 20; i += 1) {
      await searchGamesSemantic(supabase, {
        query: "atmospheric sci-fi",
        clientId: "client-rate",
      });
    }

    mockSearchGameIds.mockClear();
    const outcome = await searchGamesSemantic(supabase, {
      query: "atmospheric sci-fi",
      clientId: "client-rate",
    });

    expect(outcome.mode).toBe("lexical_fallback");
    expect(mockSearchGameIds).not.toHaveBeenCalled();
    expect(mockSearchLocalGames).toHaveBeenCalled();
  });

  it("degrades to lexical fallback when Pinecone throws PineconeIndexUnavailableError", async () => {
    mockSearchGameIds.mockRejectedValue(
      new PineconeIndexUnavailableError("index missing"),
    );
    const supabase = makeSupabaseStub({ data: [] });

    const outcome = await searchGamesSemantic(supabase, {
      query: "cosy farming game",
      clientId: "client-a",
    });

    expect(outcome.mode).toBe("lexical_fallback");
    expect(mockSearchLocalGames).toHaveBeenCalledWith(
      "cosy farming game",
      expect.any(Number),
    );
  });

  it("re-orders Supabase rows to match Pinecone's hit order and drops an id Supabase no longer has", async () => {
    mockSearchGameIds.mockResolvedValue([
      { gameId: "game-b", score: 0.9 },
      { gameId: "game-a", score: 0.7 },
      { gameId: "game-orphan", score: 0.5 },
    ]);
    const supabase = makeSupabaseStub({
      data: [
        {
          id: "game-a",
          igdb_id: 1,
          slug: "game-a",
          name: "Game A",
          cover_image_id: null,
          release_date: null,
          igdb_game_type: null,
          version_parent_igdb_id: null,
        },
        {
          id: "game-b",
          igdb_id: 2,
          slug: "game-b",
          name: "Game B",
          cover_image_id: null,
          release_date: null,
          igdb_game_type: null,
          version_parent_igdb_id: null,
        },
      ],
    });

    const outcome = await searchGamesSemantic(supabase, {
      query: "difficult tactical rpg",
      clientId: "client-b",
    });

    expect(outcome.mode).toBe("semantic");
    expect(outcome.results.map((r) => r.slug)).toEqual(["game-b", "game-a"]);
  });

  it("uses the passed-in request-scoped client, never an admin or internally-created one", async () => {
    mockSearchGameIds.mockResolvedValue([{ gameId: "game-a", score: 0.9 }]);
    const supabase = makeSupabaseStub({ data: [] });

    await searchGamesSemantic(supabase, {
      query: "atmospheric sci-fi",
      clientId: "client-c",
    });

    expect(supabase.from).toHaveBeenCalledWith("games");
  });

  it("rejects an empty or oversized query without calling Pinecone or Supabase", async () => {
    const supabase = makeSupabaseStub({ data: [] });

    const empty = await searchGamesSemantic(supabase, {
      query: "",
      clientId: "client-d",
    });
    const oversized = await searchGamesSemantic(supabase, {
      query: "x".repeat(500),
      clientId: "client-d",
    });

    expect(empty.results).toEqual([]);
    expect(oversized.results).toEqual([]);
    expect(mockSearchGameIds).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range topK", async () => {
    const supabase = makeSupabaseStub({ data: [] });

    const outcome = await searchGamesSemantic(supabase, {
      query: "atmospheric sci-fi",
      topK: 999,
      clientId: "client-e",
    });

    expect(outcome.results).toEqual([]);
    expect(mockSearchGameIds).not.toHaveBeenCalled();
  });
});
