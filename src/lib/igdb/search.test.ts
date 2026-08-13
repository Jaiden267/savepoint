import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIgdbRequest } = vi.hoisted(() => ({
  mockIgdbRequest: vi.fn(),
}));

vi.mock("./client", () => ({
  igdbRequest: mockIgdbRequest,
}));

import { searchIgdbGames } from "./search";
import { _resetIgdbSearchCacheForTests } from "./search-cache";
import type { IgdbGameSearchRaw } from "./types";

function rawGame(
  overrides: Partial<IgdbGameSearchRaw> = {},
): IgdbGameSearchRaw {
  return {
    id: 1,
    name: "Game",
    slug: "game",
    game_type: { id: 0, type: "Main Game" },
    ...overrides,
  };
}

beforeEach(() => {
  mockIgdbRequest.mockReset();
  _resetIgdbSearchCacheForTests();
});

describe("searchIgdbGames", () => {
  it("returns the full ranked/filtered pool without truncating to `limit` — the confirmed fix for the 'lego star war' inconsistency", async () => {
    // 25 raw candidates, all real, unexcluded types — more than the
    // requested limit (10). Before the fix, this function truncated to
    // `limit` internally, discarding candidates the caller (which merges
    // with local results) never got a chance to reconsider.
    const raw = Array.from({ length: 25 }, (_, i) =>
      rawGame({ id: i + 1, name: `Game ${i + 1}`, slug: `game-${i + 1}` }),
    );
    mockIgdbRequest.mockResolvedValue(raw);

    const results = await searchIgdbGames("game", { limit: 10 });

    expect(results.length).toBeGreaterThan(10);
    expect(results).toHaveLength(25);
  });

  it("drops bundle/mod/pack-addon entries using IGDB's real returned label text", async () => {
    mockIgdbRequest.mockResolvedValue([
      rawGame({ id: 1, game_type: { id: 0, type: "Main Game" } }),
      rawGame({ id: 2, game_type: { id: 3, type: "Bundle" } }),
      rawGame({ id: 3, game_type: { id: 13, type: "Pack/Addon" } }),
    ]);

    const results = await searchIgdbGames("game");

    expect(results.map((r) => r.igdbId)).toEqual([1]);
  });

  it("ranks a real Main Game above a Port at the same match tier", async () => {
    mockIgdbRequest.mockResolvedValue([
      rawGame({
        id: 1,
        name: "LEGO Star Wars III: The Clone Wars",
        game_type: { id: 11, type: "Port" },
      }),
      rawGame({
        id: 2,
        name: "LEGO Star Wars III: The Clone Wars",
        game_type: { id: 0, type: "Main Game" },
      }),
    ]);

    const results = await searchIgdbGames("lego star war");

    expect(results.map((r) => r.igdbId)).toEqual([2, 1]);
  });

  it("caches by normalized query + limit, never re-fetching within the TTL", async () => {
    mockIgdbRequest.mockResolvedValue([rawGame({ id: 1 })]);

    await searchIgdbGames("Zelda", { limit: 20 });
    await searchIgdbGames("  zelda  ", { limit: 20 });

    expect(mockIgdbRequest).toHaveBeenCalledTimes(1);
  });
});
