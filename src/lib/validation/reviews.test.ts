import { describe, it, expect } from "vitest";
import {
  reviewBodySchema,
  reviewCommentBodySchema,
  createReviewSchema,
  updateReviewSchema,
  toggleReviewLikeSchema,
  createReviewCommentSchema,
} from "./reviews";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const reviewId = "5ee2dfc9-4557-5278-b5c8-285b9f0f1b69";
const gameSlug = "the-legend-of-zelda";

describe("reviewBodySchema / reviewCommentBodySchema — distinct caps", () => {
  it("accepts a review body up to 10000 characters", () => {
    expect(reviewBodySchema.safeParse("a".repeat(10000)).success).toBe(true);
    expect(reviewBodySchema.safeParse("a".repeat(10001)).success).toBe(false);
  });

  it("rejects an empty review body", () => {
    expect(reviewBodySchema.safeParse("").success).toBe(false);
  });

  it("caps a comment body at 2000 characters, not 10000", () => {
    expect(reviewCommentBodySchema.safeParse("a".repeat(2000)).success).toBe(
      true,
    );
    expect(reviewCommentBodySchema.safeParse("a".repeat(2001)).success).toBe(
      false,
    );
  });
});

describe("createReviewSchema", () => {
  it("requires a rating", () => {
    const result = createReviewSchema.safeParse({
      gameId,
      gameSlug,
      rating: null,
      body: "Great game.",
      hasSpoilers: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload", () => {
    const result = createReviewSchema.safeParse({
      gameId,
      gameSlug,
      rating: "4.5",
      body: "Great game.",
      hasSpoilers: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateReviewSchema", () => {
  it("never accepts a gameId field", () => {
    const parsed = updateReviewSchema.safeParse({
      reviewId,
      gameSlug,
      rating: "4",
      body: "Updated review.",
      hasSpoilers: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("gameId" in parsed.data).toBe(false);
  });
});

describe("toggleReviewLikeSchema", () => {
  it("accepts a valid triple", () => {
    expect(
      toggleReviewLikeSchema.safeParse({ reviewId, nextLiked: true, gameSlug })
        .success,
    ).toBe(true);
  });

  it("accepts a null gameSlug", () => {
    expect(
      toggleReviewLikeSchema.safeParse({
        reviewId,
        nextLiked: false,
        gameSlug: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed reviewId, refusing to trust the runtime argument shape", () => {
    expect(
      toggleReviewLikeSchema.safeParse({
        reviewId: "'; drop table reviews; --",
        nextLiked: true,
        gameSlug,
      }).success,
    ).toBe(false);
  });

  it("rejects a non-boolean nextLiked", () => {
    expect(
      toggleReviewLikeSchema.safeParse({
        reviewId,
        nextLiked: "true",
        gameSlug,
      }).success,
    ).toBe(false);
  });
});

describe("createReviewCommentSchema", () => {
  it("accepts a valid payload", () => {
    expect(
      createReviewCommentSchema.safeParse({ reviewId, body: "Nice review!" })
        .success,
    ).toBe(true);
  });
});
