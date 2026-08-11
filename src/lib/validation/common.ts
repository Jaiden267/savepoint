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
