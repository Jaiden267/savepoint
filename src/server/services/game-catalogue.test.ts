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
} from "./game-catalogue";

function localRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    igdb_id: 1,
    slug: "local-game",
    name: "Local Game",
    cover_image_id: null,
    release_date: null,
    igdb_game_type: "main_game",
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
    gameType: "main_game",
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
        gameType: "main_game",
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
