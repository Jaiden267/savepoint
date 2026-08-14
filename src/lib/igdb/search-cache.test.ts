import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedSearch,
  setCachedSearch,
  invalidateCacheByPrefix,
  _resetIgdbSearchCacheForTests,
} from "./search-cache";

beforeEach(() => {
  _resetIgdbSearchCacheForTests();
});

describe("getCachedSearch / setCachedSearch", () => {
  it("round-trips a value for the default GameSearchResult shape", () => {
    const results = [{ igdbId: 1, source: "local" as const }];
    setCachedSearch("discover:123", results);
    expect(getCachedSearch("discover:123")).toEqual(results);
  });

  it("returns null for a missing key", () => {
    expect(getCachedSearch("nothing-here")).toBeNull();
  });

  it("round-trips a differently-shaped generic type without an unsafe cast at the call site", () => {
    interface RecommendationLike {
      igdbId: number;
      reason: string;
    }
    const results: RecommendationLike[] = [{ igdbId: 42, reason: "test" }];
    setCachedSearch<RecommendationLike>("recommendations:user-1:99", results);
    expect(
      getCachedSearch<RecommendationLike>("recommendations:user-1:99"),
    ).toEqual(results);
  });
});

describe("invalidateCacheByPrefix", () => {
  it("removes only keys matching the exact prefix", () => {
    setCachedSearch("recommendations:user-1:1", [{ a: 1 }]);
    setCachedSearch("recommendations:user-1:2", [{ a: 2 }]);
    setCachedSearch("recommendations:user-2:1", [{ a: 3 }]);
    setCachedSearch("discover:1", [{ a: 4 }]);

    invalidateCacheByPrefix("recommendations:user-1:");

    expect(getCachedSearch("recommendations:user-1:1")).toBeNull();
    expect(getCachedSearch("recommendations:user-1:2")).toBeNull();
    // A different user's recommendations entries are untouched.
    expect(getCachedSearch("recommendations:user-2:1")).toEqual([{ a: 3 }]);
    // An unrelated feature's cache entries are untouched.
    expect(getCachedSearch("discover:1")).toEqual([{ a: 4 }]);
  });

  it("is a no-op when nothing matches the prefix", () => {
    setCachedSearch("discover:1", [{ a: 1 }]);
    expect(() =>
      invalidateCacheByPrefix("recommendations:nobody:"),
    ).not.toThrow();
    expect(getCachedSearch("discover:1")).toEqual([{ a: 1 }]);
  });
});
