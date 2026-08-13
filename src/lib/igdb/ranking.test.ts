import { describe, it, expect } from "vitest";
import { rankSearchResults, excludeUnwantedGameTypes } from "./ranking";
import type { GameSearchResult } from "./types";

function result(overrides: Partial<GameSearchResult>): GameSearchResult {
  return {
    source: "igdb",
    igdbId: 1,
    slug: "slug",
    name: "Name",
    coverImageId: null,
    releaseYear: null,
    gameType: "Main Game",
    versionParentIgdbId: null,
    ...overrides,
  };
}

describe("excludeUnwantedGameTypes", () => {
  it("drops bundle/mod/pack entries, keeping everything else — using IGDB's real returned label text (Title Case, 'Pack/Addon' not 'Pack')", () => {
    const results = [
      result({ igdbId: 1, gameType: "Main Game" }),
      result({ igdbId: 2, gameType: "Bundle" }),
      result({ igdbId: 3, gameType: "Mod" }),
      result({ igdbId: 4, gameType: "Pack/Addon" }),
      result({ igdbId: 5, gameType: "DLC" }),
    ];

    expect(excludeUnwantedGameTypes(results).map((r) => r.igdbId)).toEqual([
      1, 5,
    ]);
  });

  it("keeps entries with no known game type", () => {
    expect(
      excludeUnwantedGameTypes([result({ igdbId: 1, gameType: null })]),
    ).toHaveLength(1);
  });
});

describe("rankSearchResults", () => {
  it("ranks the canonical 'The Legend of Zelda' search correctly", () => {
    const canonical = result({ igdbId: 3, name: "The Legend of Zelda" });
    const ocarina = result({
      igdbId: 2,
      name: "The Legend of Zelda: Ocarina of Time",
    });
    const breathOfTheWild = result({
      igdbId: 4,
      name: "The Legend of Zelda: Breath of the Wild",
    });
    const edition = result({
      igdbId: 7,
      name: "The Legend of Zelda: Collector's Edition",
      versionParentIgdbId: 3,
    });
    const unrelated = result({ igdbId: 6, name: "Zelda's Adventure" });

    const ranked = rankSearchResults("The Legend of Zelda", [
      unrelated,
      edition,
      breathOfTheWild,
      ocarina,
      canonical,
    ]);

    expect(ranked[0]).toBe(canonical);
    const ocarinaIndex = ranked.indexOf(ocarina);
    const breathIndex = ranked.indexOf(breathOfTheWild);
    const editionIndex = ranked.indexOf(edition);
    const unrelatedIndex = ranked.indexOf(unrelated);

    // Prefix-matching canonical sequels rank above the edition (version
    // penalty), which in turn ranks above the unrelated title (weak/no
    // match at all).
    expect(ocarinaIndex).toBeLessThan(editionIndex);
    expect(breathIndex).toBeLessThan(editionIndex);
    expect(editionIndex).toBeLessThan(unrelatedIndex);
  });

  it("sinks a mod/bundle/pack-typed entry to the bottom even if it slips past the upstream exclusion filter", () => {
    const canonical = result({ igdbId: 1, name: "The Legend of Zelda" });
    const modTrap = result({
      igdbId: 2,
      name: "The Legend of Zelda Randomizer",
      gameType: "Mod",
    });
    const unrelated = result({ igdbId: 3, name: "Completely Different Game" });

    const ranked = rankSearchResults("The Legend of Zelda", [
      modTrap,
      unrelated,
      canonical,
    ]);

    expect(ranked[0]).toBe(canonical);
    // The mod-tagged entry still starts with the query (tier 1) so it
    // outranks a totally unrelated title, but its type penalty (unknown/
    // excluded types fall through to the worst bucket) keeps it below any
    // real Main Game/DLC/etc result at the same match tier.
    const dlcLikeCompetitor = result({
      igdbId: 4,
      name: "The Legend of Zelda: Expansion Pass",
      gameType: "DLC",
    });
    const rankedWithCompetitor = rankSearchResults("The Legend of Zelda", [
      modTrap,
      dlcLikeCompetitor,
    ]);
    expect(rankedWithCompetitor[0]).toBe(dlcLikeCompetitor);
  });

  it("prioritizes a real Main Game over a Port/DLC-typed entry at the same match tier — regression for the type-penalty key mismatch that made every real IGDB type fall through to 'unknown' (the 'lego star war' ranking gap)", () => {
    const mainGame = result({
      igdbId: 1,
      name: "LEGO Star Wars III: The Clone Wars",
      gameType: "Main Game",
    });
    const port = result({
      igdbId: 2,
      name: "LEGO Star Wars III: The Clone Wars",
      gameType: "Port",
    });
    const unknownType = result({
      igdbId: 3,
      name: "LEGO Star Wars III: The Clone Wars",
      gameType: "SomeFutureIgdbType",
    });

    const ranked = rankSearchResults("lego star war", [
      unknownType,
      port,
      mainGame,
    ]);

    expect(ranked.map((r) => r.igdbId)).toEqual([1, 2, 3]);
  });

  it("ranks a merged local+IGDB set purely by match/version/type — source has no influence", () => {
    const weakLocalMatch = result({
      source: "local",
      igdbId: 1,
      name: "Something Zelda-Adjacent",
    });
    const exactIgdbMatch = result({
      source: "igdb",
      igdbId: 2,
      name: "The Legend of Zelda",
    });

    const ranked = rankSearchResults("The Legend of Zelda", [
      weakLocalMatch,
      exactIgdbMatch,
    ]);

    expect(ranked[0]).toBe(exactIgdbMatch);
  });

  it("is a stable sort, preserving input order within the same tier/penalty", () => {
    const a = result({ igdbId: 1, name: "Same Tier Game A" });
    const b = result({ igdbId: 2, name: "Same Tier Game B" });

    const ranked = rankSearchResults("nonmatching query", [a, b]);

    expect(ranked).toEqual([a, b]);
  });
});
