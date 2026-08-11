import { z } from "zod";
import { starRatingSchema } from "@/lib/rating";

/** Shared uuid validator for id-shaped Server Action args (never the raw table PK column name — that's a DB concern, this is the transport-boundary check). */
export const uuidSchema = z.uuid();

/**
 * Normalizes a raw FormData value before star-rating validation. A selected
 * radio arrives as a string ("3.5"); an unselected/absent group arrives as
 * null. NaN/garbage strings pass through UNCHANGED (not coerced to null or
 * 0) so starRatingSchema's z.number() rejects them with a real Zod issue —
 * never silently treated as "no rating" or "0.5 stars" when the actual input
 * was invalid.
 */
function toNumberOrRaw(value: FormDataEntryValue | null): unknown {
  if (value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

/** For a mandatory rating field (e.g. a review's rating) — missing/invalid both fail validation. */
export const requiredStarsFieldSchema = z.preprocess(
  toNumberOrRaw,
  starRatingSchema,
);

/** For an optional rating field (e.g. a diary entry's rating) — missing becomes null; invalid non-empty input still fails validation. */
export const optionalStarsFieldSchema = z.preprocess(
  toNumberOrRaw,
  starRatingSchema.nullable(),
);

/**
 * Shape of a decoded activity-feed keyset cursor: the `created_at`/`id` of
 * the last row on the previous page, used to build a `(created_at, id) <
 * (t, i)` comparison for the next page. Validated on decode so a
 * malformed/tampered cursor (bad base64, wrong shape, non-uuid `i`) is
 * rejected with a friendly reset to page 1 rather than a raw error — see
 * src/server/services/activity-feed.ts for the encode/decode functions that
 * use this.
 */
export const cursorSchema = z.object({
  t: z.iso.datetime({ offset: true }),
  i: uuidSchema,
});
export type Cursor = z.infer<typeof cursorSchema>;
