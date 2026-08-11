import { describe, it, expect } from "vitest";
import {
  libraryStatusSchema,
  setGameStatusSchema,
  rateGameSchema,
  clearRatingSchema,
  removeFromLibrarySchema,
} from "./library";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const gameSlug = "the-legend-of-zelda";

describe("libraryStatusSchema", () => {
  it("accepts every DB-valid status", () => {
    for (const status of [
      "wishlist",
      "backlog",
      "playing",
      "completed",
      "paused",
      "dropped",
    ]) {
      expect(libraryStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects a status the DB CHECK constraint would reject", () => {
    expect(libraryStatusSchema.safeParse("finished").success).toBe(false);
    expect(libraryStatusSchema.safeParse("").success).toBe(false);
  });
});

describe("setGameStatusSchema", () => {
  it("accepts a valid payload", () => {
    expect(
      setGameStatusSchema.safeParse({ gameId, gameSlug, status: "playing" })
        .success,
    ).toBe(true);
  });

  it("rejects an invalid gameId", () => {
    expect(
      setGameStatusSchema.safeParse({
        gameId: "not-a-uuid",
        gameSlug,
        status: "playing",
      }).success,
    ).toBe(false);
  });
});

describe("rateGameSchema", () => {
  it("accepts a valid stars value", () => {
    const result = rateGameSchema.safeParse({ gameId, gameSlug, stars: "3.5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stars).toBe(3.5);
  });

  it("rejects a missing rating — required here", () => {
    expect(
      rateGameSchema.safeParse({ gameId, gameSlug, stars: null }).success,
    ).toBe(false);
  });
});

describe("clearRatingSchema / removeFromLibrarySchema", () => {
  it("accept a valid gameId/gameSlug pair", () => {
    expect(clearRatingSchema.safeParse({ gameId, gameSlug }).success).toBe(
      true,
    );
    expect(
      removeFromLibrarySchema.safeParse({ gameId, gameSlug }).success,
    ).toBe(true);
  });
});
