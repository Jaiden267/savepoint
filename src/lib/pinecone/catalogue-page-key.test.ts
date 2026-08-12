import { describe, it, expect } from "vitest";
import { buildCataloguePageKey } from "./catalogue-page-key";

const BASE_INPUT = {
  cursorName: "discover:balanced:gen1",
  candidates: [{ igdbId: 2, profile: "balanced", igdbUpdatedAtUnix: 200 }],
  markIneligible: [],
  newLastIgdbId: 2,
  newLastUpdatedAtUnix: null,
  newLastUpdatedAtIgdbId: null,
  newLastReleaseCheckUnix: null,
  newLastReleaseCheckIgdbId: null,
  markCompleted: false,
};

describe("buildCataloguePageKey", () => {
  it("is deterministic — the same logical page always produces the same key", () => {
    const a = buildCataloguePageKey(BASE_INPUT);
    const b = buildCataloguePageKey({ ...BASE_INPUT });
    expect(a).toBe(b);
  });

  it("is independent of candidate array order (sorted internally by igdb_id)", () => {
    const forward = buildCataloguePageKey({
      ...BASE_INPUT,
      candidates: [
        { igdbId: 1, profile: "balanced", igdbUpdatedAtUnix: 100 },
        { igdbId: 2, profile: "balanced", igdbUpdatedAtUnix: 200 },
      ],
    });
    const reversed = buildCataloguePageKey({
      ...BASE_INPUT,
      candidates: [
        { igdbId: 2, profile: "balanced", igdbUpdatedAtUnix: 200 },
        { igdbId: 1, profile: "balanced", igdbUpdatedAtUnix: 100 },
      ],
    });
    expect(forward).toBe(reversed);
  });

  it("changes when candidate metadata changes, not just candidate ids", () => {
    const original = buildCataloguePageKey(BASE_INPUT);
    const differentUpdatedAt = buildCataloguePageKey({
      ...BASE_INPUT,
      candidates: [{ igdbId: 2, profile: "balanced", igdbUpdatedAtUnix: 999 }],
    });
    expect(original).not.toBe(differentUpdatedAt);
  });

  it("changes when the ineligible-id set changes", () => {
    const original = buildCataloguePageKey(BASE_INPUT);
    const withIneligible = buildCataloguePageKey({
      ...BASE_INPUT,
      markIneligible: [55],
    });
    expect(original).not.toBe(withIneligible);
  });

  it("is independent of ineligible-id array order (sorted internally)", () => {
    const forward = buildCataloguePageKey({
      ...BASE_INPUT,
      markIneligible: [1, 2, 3],
    });
    const shuffled = buildCataloguePageKey({
      ...BASE_INPUT,
      markIneligible: [3, 1, 2],
    });
    expect(forward).toBe(shuffled);
  });

  it("changes when any compound cursor value changes", () => {
    const original = buildCataloguePageKey(BASE_INPUT);
    const variants = [
      { ...BASE_INPUT, newLastIgdbId: 3 },
      { ...BASE_INPUT, newLastUpdatedAtUnix: 12345 },
      { ...BASE_INPUT, newLastUpdatedAtIgdbId: 7 },
      { ...BASE_INPUT, newLastReleaseCheckUnix: 999 },
      { ...BASE_INPUT, newLastReleaseCheckIgdbId: 8 },
      { ...BASE_INPUT, markCompleted: true },
    ];
    for (const variant of variants) {
      expect(buildCataloguePageKey(variant)).not.toBe(original);
    }
  });

  it("changes when the cursor name changes (a page for one cursor never collides with another)", () => {
    const original = buildCataloguePageKey(BASE_INPUT);
    const otherCursor = buildCataloguePageKey({
      ...BASE_INPUT,
      cursorName: "incremental:balanced",
    });
    expect(original).not.toBe(otherCursor);
  });
});
