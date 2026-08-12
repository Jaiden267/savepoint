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
import { PINECONE_SCHEMA_VERSION } from "@/lib/pinecone/constants";

interface ChainResult {
  data: unknown;
}

/**
 * Records exactly what column filter the hydration query used, so the
 * regression test below can assert `.in("igdb_id", ...)` is the only
 * filter ever built from a hit-derived value — never `.in("id", ...)`,
 * which would throw a real Postgres invalid-uuid error against a v2
 * (`igdb-*`) record id.
 */
function makeSupabaseStub(result: ChainResult) {
  const inCalls: { column: string; values: unknown[] }[] = [];
  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn((column: string, values: unknown[]) => {
      inCalls.push({ column, values });
      return Promise.resolve(result);
    }),
  };
  const supabase = { from: vi.fn(() => chain) } as unknown as Parameters<
    typeof searchGamesSemantic
  >[0];
  return { supabase, inCalls };
}

function catalogueFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: PINECONE_SCHEMA_VERSION,
    igdb_id: 999,
    slug: "catalogue-only-game",
    name: "Catalogue Only Game",
    cover_image_id: "cover-abc",
    release_year: 2019,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockSearchLocalGames.mockResolvedValue([{ slug: "fallback-game" }]);
});

describe("searchGamesSemantic", () => {
  it("degrades to lexical fallback, without calling Pinecone, once the per-client rate limit is exceeded", async () => {
    mockSearchGameIds.mockResolvedValue([]);
    const { supabase } = makeSupabaseStub({ data: [] });
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
    const { supabase } = makeSupabaseStub({ data: [] });

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

  it("re-orders Supabase rows to match Pinecone's hit order and drops a hit that resolves to neither a Supabase row nor valid catalogue metadata", async () => {
    mockSearchGameIds.mockResolvedValue([
      { igdbId: 2, score: 0.9, fields: { igdb_id: 2 } },
      { igdbId: 1, score: 0.7, fields: { igdb_id: 1 } },
      { igdbId: 9999, score: 0.5, fields: { igdb_id: 9999 } }, // orphan: no Supabase row, no valid catalogue metadata either
    ]);
    const { supabase } = makeSupabaseStub({
      data: [
        {
          id: "uuid-a",
          igdb_id: 1,
          slug: "game-a",
          name: "Game A",
          cover_image_id: null,
          release_date: null,
          igdb_game_type: null,
          version_parent_igdb_id: null,
        },
        {
          id: "uuid-b",
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

  describe("UUID-vs-IGDB-id hydration regression (mixed v1/v2 index)", () => {
    it("hydrates by igdb_id only — never builds an .in('id', ...) filter from a hit-derived value, for a mix of v1 (raw-UUID top-level id) and v2 (igdb-*) hits", async () => {
      // Two hits shaped exactly like a real mixed index would produce: one
      // whose Pinecone record's own top-level id is a raw Supabase UUID
      // (an un-migrated v1 record) and one whose id is `igdb-*` (v2) — the
      // service must never see or use that top-level id at all, only each
      // hit's `igdbId`/`fields.igdb_id`, which is a plain number on both.
      mockSearchGameIds.mockResolvedValue([
        { igdbId: 501, score: 0.9, fields: { igdb_id: 501 } }, // "came from" a v1 record
        { igdbId: 502, score: 0.8, fields: { igdb_id: 502 } }, // "came from" a v2 record
      ]);
      const { supabase, inCalls } = makeSupabaseStub({
        data: [
          {
            id: "3f1b1a4e-6b6b-4b1a-8b1a-6b6b4b1a8b1a",
            igdb_id: 501,
            slug: "legacy-game",
            name: "Legacy Game",
            cover_image_id: null,
            release_date: null,
            igdb_game_type: null,
            version_parent_igdb_id: null,
          },
          {
            id: "9c2f4a11-2222-4444-8888-abcdefabcdef",
            igdb_id: 502,
            slug: "new-game",
            name: "New Game",
            cover_image_id: null,
            release_date: null,
            igdb_game_type: null,
            version_parent_igdb_id: null,
          },
        ],
      });

      const outcome = await searchGamesSemantic(supabase, {
        query: "anything",
        clientId: "client-uuid-regression",
      });

      // Exactly one hydration query, filtered on igdb_id, never on id —
      // the only way this suite can prove a real Postgres
      // invalid-input-syntax-for-uuid error can't occur here.
      expect(inCalls).toHaveLength(1);
      expect(inCalls[0]!.column).toBe("igdb_id");
      expect(inCalls[0]!.values).toEqual([501, 502]);
      expect(inCalls.some((call) => call.column === "id")).toBe(false);

      expect(outcome.results.map((r) => r.slug)).toEqual([
        "legacy-game",
        "new-game",
      ]);
    });
  });

  describe("catalogue-only rendering (Prompt 7C)", () => {
    it("renders a hit with no matching Supabase row from its own validated v2 metadata instead of dropping it", async () => {
      mockSearchGameIds.mockResolvedValue([
        { igdbId: 999, score: 0.8, fields: catalogueFields() },
      ]);
      const { supabase } = makeSupabaseStub({ data: [] });

      const outcome = await searchGamesSemantic(supabase, {
        query: "a game nobody has cached",
        clientId: "client-catalogue",
      });

      expect(outcome.results).toEqual([
        {
          source: "igdb",
          igdbId: 999,
          slug: "catalogue-only-game",
          name: "Catalogue Only Game",
          coverImageId: "cover-abc",
          releaseYear: 2019,
          gameType: null,
          versionParentIgdbId: null,
        },
      ]);
    });

    it("fails closed on a legacy v1 hit with no matching Supabase row (no schema_version, incomplete metadata) — drops it rather than rendering garbage", async () => {
      mockSearchGameIds.mockResolvedValue([
        {
          igdbId: 501,
          score: 0.8,
          fields: { igdb_id: 501 }, // v1 shape — no schema_version, no slug/name
        },
      ]);
      const { supabase } = makeSupabaseStub({ data: [] });

      const outcome = await searchGamesSemantic(supabase, {
        query: "an uncached legacy hit",
        clientId: "client-legacy-drop",
      });

      expect(outcome.results).toEqual([]);
    });

    it("fails closed on a partially-written / corrupt v2-ish record (missing required field)", async () => {
      mockSearchGameIds.mockResolvedValue([
        {
          igdbId: 999,
          score: 0.8,
          fields: catalogueFields({ slug: undefined }),
        },
      ]);
      const { supabase } = makeSupabaseStub({ data: [] });

      const outcome = await searchGamesSemantic(supabase, {
        query: "a corrupt record",
        clientId: "client-corrupt-drop",
      });

      expect(outcome.results).toEqual([]);
    });

    it("dedupes by igdb_id when both a cached Supabase row and a catalogue-only hit resolve to the same game, keeping the higher-ranked one", async () => {
      mockSearchGameIds.mockResolvedValue([
        { igdbId: 42, score: 0.95, fields: catalogueFields({ igdb_id: 42 }) }, // ranked first
        { igdbId: 42, score: 0.4, fields: { igdb_id: 42 } }, // duplicate, lower-ranked
      ]);
      const { supabase } = makeSupabaseStub({
        data: [
          {
            id: "uuid-42",
            igdb_id: 42,
            slug: "already-cached",
            name: "Already Cached",
            cover_image_id: null,
            release_date: null,
            igdb_game_type: null,
            version_parent_igdb_id: null,
          },
        ],
      });

      const outcome = await searchGamesSemantic(supabase, {
        query: "duplicate igdb_id across two hits",
        clientId: "client-dedupe",
      });

      // The first-ranked hit (score 0.95) already matched a Supabase row,
      // so it renders as the cached result — the second, lower-ranked hit
      // for the same igdb_id is dropped rather than rendered again.
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0]!.slug).toBe("already-cached");
    });

    it("preserves Pinecone's rank order across a mixed cached/catalogue-only result set", async () => {
      mockSearchGameIds.mockResolvedValue([
        { igdbId: 999, score: 0.9, fields: catalogueFields({ igdb_id: 999 }) }, // catalogue-only, ranked 1st
        { igdbId: 1, score: 0.8, fields: { igdb_id: 1 } }, // cached, ranked 2nd
        {
          igdbId: 998,
          score: 0.7,
          fields: catalogueFields({ igdb_id: 998, slug: "third-place" }),
        }, // catalogue-only, ranked 3rd
      ]);
      const { supabase } = makeSupabaseStub({
        data: [
          {
            id: "uuid-1",
            igdb_id: 1,
            slug: "cached-game",
            name: "Cached Game",
            cover_image_id: null,
            release_date: null,
            igdb_game_type: null,
            version_parent_igdb_id: null,
          },
        ],
      });

      const outcome = await searchGamesSemantic(supabase, {
        query: "mixed rank order",
        clientId: "client-mixed-order",
      });

      expect(outcome.results.map((r) => r.slug)).toEqual([
        "catalogue-only-game",
        "cached-game",
        "third-place",
      ]);
      expect(outcome.results.map((r) => r.source)).toEqual([
        "igdb",
        "local",
        "igdb",
      ]);
    });
  });

  it("uses the passed-in request-scoped client, never an admin or internally-created one", async () => {
    mockSearchGameIds.mockResolvedValue([
      { igdbId: 1, score: 0.9, fields: { igdb_id: 1 } },
    ]);
    const { supabase } = makeSupabaseStub({ data: [] });

    await searchGamesSemantic(supabase, {
      query: "atmospheric sci-fi",
      clientId: "client-c",
    });

    expect(supabase.from).toHaveBeenCalledWith("games");
  });

  it("rejects an empty or oversized query without calling Pinecone or Supabase", async () => {
    const { supabase } = makeSupabaseStub({ data: [] });

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
    const { supabase } = makeSupabaseStub({ data: [] });

    const outcome = await searchGamesSemantic(supabase, {
      query: "atmospheric sci-fi",
      topK: 999,
      clientId: "client-e",
    });

    expect(outcome.results).toEqual([]);
    expect(mockSearchGameIds).not.toHaveBeenCalled();
  });
});
