import { z } from "zod";
import { uuidSchema, requiredStarsFieldSchema } from "@/lib/validation/common";
import { gameSlugSchema } from "@/lib/validation/games";

/**
 * Mirrors user_games_status_check exactly (see
 * supabase/migrations/20260811121500_create_user_content_tables.sql).
 */
export const libraryStatusSchema = z.enum([
  "wishlist",
  "backlog",
  "playing",
  "completed",
  "paused",
  "dropped",
]);
export type LibraryStatus = z.infer<typeof libraryStatusSchema>;

export const setGameStatusSchema = z.object({
  gameId: uuidSchema,
  gameSlug: gameSlugSchema,
  status: libraryStatusSchema,
});
export type SetGameStatusInput = z.infer<typeof setGameStatusSchema>;

export const rateGameSchema = z.object({
  gameId: uuidSchema,
  gameSlug: gameSlugSchema,
  stars: requiredStarsFieldSchema,
});
export type RateGameInput = z.infer<typeof rateGameSchema>;

export const clearRatingSchema = z.object({
  gameId: uuidSchema,
  gameSlug: gameSlugSchema,
});
export type ClearRatingInput = z.infer<typeof clearRatingSchema>;

export const removeFromLibrarySchema = z.object({
  gameId: uuidSchema,
  gameSlug: gameSlugSchema,
});
export type RemoveFromLibraryInput = z.infer<typeof removeFromLibrarySchema>;
