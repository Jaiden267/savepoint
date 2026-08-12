import { describe, it, expect } from "vitest";
import {
  CATALOGUE_PROFILES,
  resolveProfileTypeIds,
  buildCatalogueWhereClause,
  buildReleaseCheckWhereClause,
  buildIncrementalWhereClause,
  isEligibleForCatalogue,
  type CatalogueProfileName,
  type CatalogueScanCandidate,
} from "./catalogue-profile";

// Mirrors the real live-resolved game_types table (see docs/PINECONE.md's
// Gate B numbers) — never hardcoded ids assumed by this test, only used as
// a realistic fixture for the resolver.
const GAME_TYPES = [
  { id: 0, type: "Main Game" },
  { id: 1, type: "DLC" },
  { id: 2, type: "Expansion" },
  { id: 3, type: "Bundle" },
  { id: 4, type: "Standalone Expansion" },
  { id: 5, type: "Mod" },
  { id: 8, type: "Remake" },
  { id: 9, type: "Remaster" },
  { id: 10, type: "Expanded Game" },
  { id: 12, type: "Fork" },
  { id: 13, type: "Pack / Addon" },
];

describe("resolveProfileTypeIds", () => {
  it("resolves conservative to just Main Game's live id", () => {
    expect(resolveProfileTypeIds("conservative", GAME_TYPES)).toEqual([0]);
  });

  it("resolves balanced to Main Game + Remake + Remaster + Expanded Game", () => {
    expect(resolveProfileTypeIds("balanced", GAME_TYPES).sort()).toEqual(
      [0, 8, 9, 10].sort(),
    );
  });

  it("resolves broad to the excluded set (Bundle/Mod/Fork/Pack)", () => {
    expect(resolveProfileTypeIds("broad", GAME_TYPES).sort()).toEqual(
      [3, 5, 12, 13].sort(),
    );
  });

  it("matches type names case-insensitively", () => {
    const lowered = GAME_TYPES.map((t) => ({
      ...t,
      type: t.type.toLowerCase(),
    }));
    expect(resolveProfileTypeIds("conservative", lowered)).toEqual([0]);
  });
});

describe("buildCatalogueWhereClause", () => {
  it("builds an include-mode clause for conservative/balanced", () => {
    const where = buildCatalogueWhereClause({
      profile: "balanced",
      gameTypes: GAME_TYPES,
      nowUnixSeconds: 1_700_000_000,
    });
    expect(where).toContain("game_type = (");
    expect(where).toContain("total_rating_count >= 1");
    expect(where).not.toContain("id >");
  });

  it("builds an exclude-mode clause for broad", () => {
    const where = buildCatalogueWhereClause({
      profile: "broad",
      gameTypes: GAME_TYPES,
      nowUnixSeconds: 1_700_000_000,
    });
    expect(where).toContain("game_type != (");
  });

  it("adds the id cursor clause only when afterIgdbId is provided", () => {
    const withCursor = buildCatalogueWhereClause({
      profile: "balanced",
      gameTypes: GAME_TYPES,
      nowUnixSeconds: 1_700_000_000,
      afterIgdbId: 500,
    });
    expect(withCursor).toContain("id > 500");
  });
});

describe("buildReleaseCheckWhereClause — tie-safe parenthesization", () => {
  it("wraps the compound OR watermark condition in its own parens before combining with other filters", () => {
    const where = buildReleaseCheckWhereClause({
      profile: "balanced",
      gameTypes: GAME_TYPES,
      afterReleaseDateUnix: 1_600_000_000,
      tieBreakIgdbId: 42,
      nowUnixSeconds: 1_700_000_000,
    });
    // The watermark clause must appear as one fully-parenthesized unit —
    // ((a > X) | (a = X & id > Y)) — never bare, before it's ANDed with
    // the rest of the filter.
    expect(where).toMatch(
      /^\(\(first_release_date > 1600000000\) \| \(first_release_date = 1600000000 & id > 42\)\) & /,
    );
  });

  it("includes the profile's non-date filters after the watermark clause", () => {
    const where = buildReleaseCheckWhereClause({
      profile: "conservative",
      gameTypes: GAME_TYPES,
      afterReleaseDateUnix: 0,
      tieBreakIgdbId: 0,
      nowUnixSeconds: 1_700_000_000,
    });
    expect(where).toContain("cover != null");
    expect(where).toContain("total_rating_count >= 1");
    expect(where).toContain("game_type = (0)");
  });
});

describe("buildIncrementalWhereClause — tie-safe, no profile filter", () => {
  it("wraps its own compound OR watermark condition in parens", () => {
    const where = buildIncrementalWhereClause({
      afterUpdatedAtUnix: 1_600_000_000,
      tieBreakIgdbId: 42,
    });
    expect(where).toBe(
      "((updated_at > 1600000000) | (updated_at = 1600000000 & id > 42))",
    );
  });

  it("never carries any profile-specific filter — deliberately unfiltered server-side", () => {
    const where = buildIncrementalWhereClause({
      afterUpdatedAtUnix: 0,
      tieBreakIgdbId: 0,
    });
    expect(where).not.toContain("game_type");
    expect(where).not.toContain("total_rating_count");
  });
});

function candidate(
  overrides: Partial<CatalogueScanCandidate> = {},
): CatalogueScanCandidate {
  return {
    id: 1,
    gameType: "Main Game",
    firstReleaseDateUnix: 1_000,
    coverImageId: "cover-1",
    summary: "A summary.",
    storyline: null,
    totalRatingCount: 5,
    updatedAtUnix: 1_000,
    ...overrides,
  };
}

describe("isEligibleForCatalogue — client-side predicate", () => {
  const NOW = 2_000;

  it("accepts a fully-eligible Main Game for every profile that includes it", () => {
    expect(isEligibleForCatalogue(candidate(), "conservative", NOW)).toBe(true);
    expect(isEligibleForCatalogue(candidate(), "balanced", NOW)).toBe(true);
    expect(isEligibleForCatalogue(candidate(), "broad", NOW)).toBe(true);
  });

  it("rejects a Bundle only under broad's exclude-mode filter, accepts it under conservative/balanced's absence from the include set", () => {
    const bundle = candidate({ gameType: "Bundle" });
    expect(isEligibleForCatalogue(bundle, "conservative", NOW)).toBe(false);
    expect(isEligibleForCatalogue(bundle, "balanced", NOW)).toBe(false);
    expect(isEligibleForCatalogue(bundle, "broad", NOW)).toBe(false);
  });

  it("rejects a future release date", () => {
    expect(
      isEligibleForCatalogue(
        candidate({ firstReleaseDateUnix: NOW + 1 }),
        "balanced",
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects a null release date", () => {
    expect(
      isEligibleForCatalogue(
        candidate({ firstReleaseDateUnix: null }),
        "balanced",
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects missing cover art", () => {
    expect(
      isEligibleForCatalogue(
        candidate({ coverImageId: null }),
        "balanced",
        NOW,
      ),
    ).toBe(false);
  });

  it("accepts storyline as a fallback when summary is absent", () => {
    expect(
      isEligibleForCatalogue(
        candidate({ summary: null, storyline: "A tale." }),
        "balanced",
        NOW,
      ),
    ).toBe(true);
  });

  it("rejects when both summary and storyline are absent", () => {
    expect(
      isEligibleForCatalogue(
        candidate({ summary: null, storyline: null }),
        "balanced",
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects zero real-engagement games (total_rating_count 0 or null)", () => {
    expect(
      isEligibleForCatalogue(
        candidate({ totalRatingCount: 0 }),
        "balanced",
        NOW,
      ),
    ).toBe(false);
    expect(
      isEligibleForCatalogue(
        candidate({ totalRatingCount: null }),
        "balanced",
        NOW,
      ),
    ).toBe(false);
  });
});

describe("agreement between server-side and client-side filter representations", () => {
  const NOW = 1_700_000_000;
  const profiles: CatalogueProfileName[] = [
    "conservative",
    "balanced",
    "broad",
  ];

  // A synthetic fixture set covering every game_type this app cares about,
  // each otherwise fully eligible — proves the two independently-evaluated
  // representations of CATALOGUE_PROFILES never silently drift apart.
  const fixtures = GAME_TYPES.map((gt) =>
    candidate({ id: gt.id, gameType: gt.type, firstReleaseDateUnix: NOW - 1 }),
  );

  for (const profile of profiles) {
    it(`${profile}: resolveProfileTypeIds' numeric membership matches isEligibleForCatalogue's string membership for every known game_type`, () => {
      const includedIds = new Set(resolveProfileTypeIds(profile, GAME_TYPES));
      const isIncludeMode = CATALOGUE_PROFILES[profile].mode === "include";

      for (const fixture of fixtures) {
        const gameType = GAME_TYPES.find((gt) => gt.id === fixture.id)!;
        const numericMatch = isIncludeMode
          ? includedIds.has(gameType.id)
          : !includedIds.has(gameType.id);
        const stringMatch = isEligibleForCatalogue(fixture, profile, NOW);
        expect(stringMatch).toBe(numericMatch);
      }
    });
  }
});
