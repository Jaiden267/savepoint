import { z } from "zod";
import { uuidSchema, optionalStarsFieldSchema } from "@/lib/validation/common";
import { gameSlugSchema } from "@/lib/validation/games";

const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * `diary_entries.played_on` has no CHECK constraint at all — old plays are
 * legitimate, so there's no lower bound. The upper bound (now + 24h, for
 * timezone slack) is a UX guard against an obviously-wrong future date, not
 * a mirror of a database constraint.
 */
export const diaryPlayedOnSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.")
  .refine(
    (value) => Date.parse(value) <= Date.now() + FUTURE_SLACK_MS,
    "Play date can't be in the future.",
  );

function emptyStringToNull(val: unknown) {
  return typeof val === "string" && val.trim() === "" ? null : val;
}

/**
 * `diary_entries.note` is PUBLIC — RLS SELECT is `to anon, authenticated
 * using (true)`, identical to every other row in this table. This is a
 * "diary note," never a "private diary note." Mirrors the DB's `note` column
 * (nullable, checked `<= 2000` chars).
 */
export const diaryNoteSchema = z.preprocess(
  emptyStringToNull,
  z
    .string()
    .trim()
    .max(2000, "Note must be 2000 characters or fewer.")
    .nullable(),
);

export const logDiaryEntrySchema = z.object({
  gameId: uuidSchema,
  gameSlug: gameSlugSchema,
  playedOn: diaryPlayedOnSchema,
  rating: optionalStarsFieldSchema,
  isReplay: z.boolean(),
  note: diaryNoteSchema,
});
export type LogDiaryEntryInput = z.infer<typeof logDiaryEntrySchema>;

// Never includes gameId — diary_entries has no UPDATE grant on game_id, and
// an "edit" must never attempt to reassign which game an entry belongs to.
export const updateDiaryEntrySchema = z.object({
  entryId: uuidSchema,
  gameSlug: gameSlugSchema,
  playedOn: diaryPlayedOnSchema,
  rating: optionalStarsFieldSchema,
  isReplay: z.boolean(),
  note: diaryNoteSchema,
});
export type UpdateDiaryEntryInput = z.infer<typeof updateDiaryEntrySchema>;

export const deleteDiaryEntrySchema = z.object({
  entryId: uuidSchema,
  gameSlug: gameSlugSchema,
});
export type DeleteDiaryEntryInput = z.infer<typeof deleteDiaryEntrySchema>;
