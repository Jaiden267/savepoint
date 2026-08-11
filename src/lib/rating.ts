import { z } from "zod";

/**
 * Ratings are stored in the database as an integer 1–10 (see the `user_games`
 * table) and displayed in the UI as 0.5–5.0 stars in half-star steps.
 *
 * This module is the single source of that conversion so the two scales never
 * drift apart. `stars = rating / 2`.
 */

/** Database rating: integer 1–10. */
export const dbRatingSchema = z.number().int().min(1).max(10);

/** UI star rating: 0.5–5.0 in half-star increments. */
export const starRatingSchema = z.number().min(0.5).max(5).multipleOf(0.5);

/** Convert a stored 1–10 rating to 0.5–5.0 stars. */
export function ratingToStars(rating: number): number {
  return dbRatingSchema.parse(rating) / 2;
}

/** Convert a 0.5–5.0 star value to the stored 1–10 rating. */
export function starsToRating(stars: number): number {
  return starRatingSchema.parse(stars) * 2;
}

/**
 * Convert `game_rating_stats.average_rating` (a rounded decimal like 7.34,
 * not one of the 10 valid discrete integers) to a 0–5 star display value.
 * Deliberately does NOT reuse ratingToStars/dbRatingSchema — that schema
 * requires an integer 1–10 and would throw on a genuine average.
 */
export function averageRatingToStars(average: number): number {
  return average / 2;
}

/**
 * Renders a 0.5–5.0 star value as "★★★½"-style glyphs. Pure formatting, no
 * React/DOM dependency — lives here (not in a "use client" component) so
 * both Server and Client Components can call it directly. It was
 * previously exported from review-card.tsx ("use client"); a Server
 * Component (own-review-card.tsx) imported and called it, which crashes at
 * runtime ("Attempted to call starGlyphs() from the server but starGlyphs
 * is on the client") — see rating.test.ts and own-review-card.test.tsx for
 * the regression coverage.
 */
export function starGlyphs(rating: number): string {
  const full = Math.floor(rating);
  return "★".repeat(full) + (rating % 1 !== 0 ? "½" : "");
}
