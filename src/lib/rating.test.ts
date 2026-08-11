import { describe, it, expect } from "vitest";
import {
  ratingToStars,
  starsToRating,
  averageRatingToStars,
  starGlyphs,
} from "./rating";

describe("rating conversion", () => {
  it("converts a stored 1-10 rating to 0.5-5.0 stars", () => {
    expect(ratingToStars(1)).toBe(0.5);
    expect(ratingToStars(7)).toBe(3.5);
    expect(ratingToStars(10)).toBe(5);
  });

  it("converts 0.5-5.0 stars back to a stored 1-10 rating", () => {
    expect(starsToRating(0.5)).toBe(1);
    expect(starsToRating(3.5)).toBe(7);
    expect(starsToRating(5)).toBe(10);
  });

  it("round-trips every valid rating", () => {
    for (let rating = 1; rating <= 10; rating++) {
      expect(starsToRating(ratingToStars(rating))).toBe(rating);
    }
  });

  it("rejects out-of-range or non-half-step values", () => {
    expect(() => ratingToStars(0)).toThrow();
    expect(() => ratingToStars(11)).toThrow();
    expect(() => ratingToStars(2.5)).toThrow();
    expect(() => starsToRating(0)).toThrow();
    expect(() => starsToRating(5.5)).toThrow();
    expect(() => starsToRating(2.25)).toThrow();
  });
});

describe("averageRatingToStars", () => {
  it("divides a rounded decimal average by 2, unlike ratingToStars", () => {
    expect(averageRatingToStars(7.34)).toBeCloseTo(3.67);
    expect(averageRatingToStars(10)).toBe(5);
    expect(averageRatingToStars(0)).toBe(0);
  });

  it("never throws on a non-integer or out-of-1-10-range value", () => {
    expect(() => averageRatingToStars(7.34)).not.toThrow();
    expect(() => averageRatingToStars(0)).not.toThrow();
  });
});

describe("starGlyphs", () => {
  it("renders whole stars with no half glyph", () => {
    expect(starGlyphs(3)).toBe("★★★");
    expect(starGlyphs(5)).toBe("★★★★★");
  });

  it("renders a half-star suffix for a fractional value", () => {
    expect(starGlyphs(3.5)).toBe("★★★½");
    expect(starGlyphs(0.5)).toBe("½");
  });

  it("is a plain, framework-agnostic function — no React/DOM dependency — so it's safe to call from a Server Component", () => {
    // A regression test in spirit, not in mechanism: this file (src/lib/rating.ts)
    // has no "use client" directive and no React import, unlike
    // review-card.tsx where starGlyphs previously lived and crashed a
    // Server Component that called it. The real cross-boundary regression
    // is exercised by own-review-card.test.tsx rendering successfully.
    expect(typeof starGlyphs).toBe("function");
    expect(starGlyphs(4)).toBe("★★★★");
  });
});
