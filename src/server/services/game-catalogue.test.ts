import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GameSearchResult } from "@/lib/igdb/types";

const { mockSearchIgdbGames, mockServerFrom } = vi.hoisted(() => ({
  mockSearchIgdbGames: vi.fn(),
  mockServerFrom: vi.fn(),
}));

vi.mock("@/lib/igdb/search", () => ({
  searchIgdbGames: mockSearchIgdbGames,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ from: mockServerFrom }),
}));

import {
  searchLocalGames,
  searchGames,
  listDiscoverGames,
  checkDiscoverRateLimit,
} from "./game-catalogue";
import {
  checkImportRateLimit,
  checkCatalogueImportRateLimit,
} from "./game-sync";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

function localRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    igdb_id: 1,
    slug: "local-game",
    name: "Local Game",
    cover_image_id: null,
    release_date: null,
    igdb_game_type: "Main Game",
    version_parent_igdb_id: null,
    ...overrides,
  };
}

function igdbResult(
  overrides: Partial<GameSearchResult> = {},
): GameSearchResult {
  return {
    source: "igdb",
    igdbId: 2,
    slug: "igdb-game",
    name: "IGDB Game",
    coverImageId: null,
    releaseYear: null,
    gameType: "Main Game",
    versionParentIgdbId: null,
    ...overrides,
  };
}

function mockSelectResult(rows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    order: vi.fn(() => chain),
    range: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  mockServerFrom.mockImplementation(() => chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
});

describe("searchLocalGames", () => {
  it("maps local rows into the unified search-result shape", async () => {
    mockSelectResult([localRow({ igdb_id: 42, slug: "the-game" })]);

    const results = await searchLocalGames("query");

    expect(results).toEqual([
      {
        source: "local",
        igdbId: 42,
        slug: "the-game",
        name: "Local Game",
        coverImageId: null,
        releaseYear: null,
        gameType: "Main Game",
        versionParentIgdbId: null,
      },
    ]);
  });
});

describe("searchGames", () => {
  it("never calls IGDB when local results are sufficient", async () => {
    mockSelectResult(
      Array.from({ length: 5 }, (_, i) =>
        localRow({ igdb_id: i, slug: `g${i}` }),
      ),
    );

    await searchGames("query");

    expect(mockSearchIgdbGames).not.toHaveBeenCalled();
  });

  it("falls back to IGDB and merges without writing anything when local results are thin", async () => {
    mockSelectResult([localRow({ igdb_id: 1, slug: "one" })]);
    mockSearchIgdbGames.mockResolvedValue([
      igdbResult({ igdbId: 2, name: "Two" }),
    ]);

    const results = await searchGames("query");

    expect(mockSearchIgdbGames).toHaveBeenCalledWith("query", { limit: 20 });
    expect(results.map((r) => r.igdbId).sort()).toEqual([1, 2]);
  });

  it("performs exactly one final rank+truncate over the full merged set — regression for the 'lego star war' bug where a relevant IGDB-only candidate was pre-truncated away before ever being merged with local results", async () => {
    // searchIgdbGames's contract is now to return its FULL overfetched pool
    // (can be larger than `limit`), not a pre-truncated `limit`-sized
    // slice — see src/lib/igdb/search.ts. A canonical Main Game candidate
    // that happens to arrive late in that larger pool (e.g. position 25 of
    // 25 — plausible given IGDB's own non-guaranteed-stable relevance
    // ordering for a broad query, plus dozens of real platform-Port
    // duplicates of the same title) must still survive the merge: only
    // ONE truncation should happen, after local + igdb are combined and
    // the (now-fixed) Main Game > Port type penalty has had a chance to
    // move it to the front of its match tier.
    mockSelectResult([]);
    const canonicalMainGame = igdbResult({
      igdbId: 999,
      name: "LEGO Star Wars III: The Clone Wars",
      gameType: "Main Game",
    });
    const portDuplicates = Array.from({ length: 24 }, (_, i) =>
      igdbResult({
        igdbId: i + 1,
        name: "LEGO Star Wars III: The Clone Wars",
        gameType: "Port",
      }),
    );
    mockSearchIgdbGames.mockResolvedValue([
      ...portDuplicates,
      canonicalMainGame,
    ]);

    const results = await searchGames("lego star war", { limit: 20 });

    expect(results.map((r) => r.igdbId)).toContain(999);
    expect(results[0].igdbId).toBe(999);
  });

  it("dedupes by igdbId, keeping the local representation for linking", async () => {
    mockSelectResult([
      localRow({ igdb_id: 1, slug: "local-slug", name: "Local Name" }),
    ]);
    mockSearchIgdbGames.mockResolvedValue([
      igdbResult({ igdbId: 1, slug: "igdb-slug", name: "IGDB Name" }),
    ]);

    const results = await searchGames("query");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: "local", slug: "local-slug" });
  });

  it("ranks the merged set globally — an exact IGDB match outranks a weak local match", async () => {
    mockSelectResult([localRow({ igdb_id: 1, name: "Something Unrelated" })]);
    mockSearchIgdbGames.mockResolvedValue([
      igdbResult({ igdbId: 2, name: "Exact Query Match" }),
    ]);

    const results = await searchGames("Exact Query Match");

    expect(results[0].igdbId).toBe(2);
  });

  it("keeps two separate IGDB games that share the same title as distinct results — identity is igdb_id, not title/slug", async () => {
    // The exact "Thor: God of Thunder" shape: one cached game and a
    // second, genuinely different IGDB game with the same displayed
    // title, disambiguated only by IGDB's own duplicate-name slug suffix.
    mockSelectResult([
      localRow({
        igdb_id: 5219,
        slug: "thor-god-of-thunder",
        name: "Thor: God of Thunder",
      }),
    ]);
    mockSearchIgdbGames.mockResolvedValue([
      igdbResult({
        igdbId: 314293,
        slug: "thor-god-of-thunder--1",
        name: "Thor: God of Thunder",
      }),
    ]);

    const results = await searchGames("thor god of thunder");

    expect(results.map((r) => r.igdbId).sort((a, b) => a - b)).toEqual([
      5219, 314293,
    ]);
    const uncached = results.find((r) => r.igdbId === 314293);
    expect(uncached).toMatchObject({
      source: "igdb",
      slug: "thor-god-of-thunder--1",
    });
  });

  it("degrades to local-only results if the IGDB fallback throws", async () => {
    mockSelectResult([localRow({ igdb_id: 1 })]);
    mockSearchIgdbGames.mockRejectedValue(new Error("IGDB unavailable"));

    const results = await searchGames("query");

    expect(results).toHaveLength(1);
    expect(results[0].igdbId).toBe(1);
  });
});

describe("listDiscoverGames", () => {
  it("reports hasMore when an extra row beyond pageSize was fetched", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `${i}` }));
    mockSelectResult(rows);

    const result = await listDiscoverGames({ page: 1, pageSize: 24 });

    expect(result.games).toHaveLength(24);
    expect(result.hasMore).toBe(true);
  });

  it("reports no more pages when fewer rows than pageSize are returned", async () => {
    mockSelectResult([{ id: "1" }, { id: "2" }]);

    const result = await listDiscoverGames({ page: 1, pageSize: 24 });

    expect(result.hasMore).toBe(false);
  });
});

describe("checkDiscoverRateLimit", () => {
  it("allows requests under the limit", () => {
    expect(checkDiscoverRateLimit("client-a").allowed).toBe(true);
  });

  it("blocks a client once it exceeds 15 requests in the window, independently of other clients", () => {
    for (let i = 0; i < 15; i++) {
      expect(checkDiscoverRateLimit("client-b").allowed).toBe(true);
    }
    expect(checkDiscoverRateLimit("client-b").allowed).toBe(false);
    // A different client's own budget is untouched.
    expect(checkDiscoverRateLimit("client-c").allowed).toBe(true);
  });

  it("is keyed separately from the existing import rate limiters — exhausting Discover's budget never touches game-import/catalogue-import for the same client, and vice versa", () => {
    for (let i = 0; i < 15; i++) checkDiscoverRateLimit("shared-client");
    expect(checkDiscoverRateLimit("shared-client").allowed).toBe(false);
    // The existing import limiters (8/60s) for the same clientId are
    // completely untouched by exhausting Discover's separate bucket.
    expect(checkImportRateLimit("shared-client").allowed).toBe(true);
    expect(checkCatalogueImportRateLimit("shared-client").allowed).toBe(true);

    // And the reverse: exhausting the existing import limiters never
    // weakens Discover's own already-exhausted state, nor grants it back.
    for (let i = 0; i < 8; i++) checkImportRateLimit("shared-client-2");
    expect(checkImportRateLimit("shared-client-2").allowed).toBe(false);
    expect(checkDiscoverRateLimit("shared-client-2").allowed).toBe(true);
  });
});
