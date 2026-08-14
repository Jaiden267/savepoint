import { z } from "zod";

/**
 * The three user-toggleable feedback types. `shown`/`clicked` are
 * append-only telemetry with no client-supplied event type at all (the
 * server always writes those literals itself) — this schema deliberately
 * excludes them so a client can never claim a telemetry event through the
 * toggle action.
 */
export const recommendationFeedbackEventTypeSchema = z.enum([
  "saved",
  "dismissed",
  "completed",
]);
export type RecommendationFeedbackEventType = z.infer<
  typeof recommendationFeedbackEventTypeSchema
>;

/**
 * The sole identity a client may supply for any recommendations
 * action/route — never a gameId/userId/slug. Mirrors
 * catalogueImportIgdbIdSchema's shape exactly (positive integer, coerced
 * from a string form field or JSON body value).
 */
export const recommendationIgdbIdSchema = z.coerce.number().int().positive();

/**
 * A batch of impression igdb_ids reported by the client after a real
 * render. Deduped and strictly capped so a client can't claim an
 * unbounded number of impressions in one call — the cap matches the
 * largest a single recommendations page ever renders.
 */
const MAX_IMPRESSION_BATCH_SIZE = 40;

export const recommendationImpressionBatchSchema = z
  .array(z.coerce.number().int().positive())
  .max(MAX_IMPRESSION_BATCH_SIZE)
  .transform((ids) => Array.from(new Set(ids)));

/**
 * Cold-start genre hints (`?genres=rpg,stealth`) — validated against the
 * real `genres` table slugs by the caller (this schema only shapes the
 * input), applied to a single request, never persisted anywhere.
 */
const MAX_GENRE_HINTS = 5;

export const recommendationGenreHintsSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(MAX_GENRE_HINTS)
  .optional();
