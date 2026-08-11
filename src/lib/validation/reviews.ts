import { z } from "zod";
import { uuidSchema, requiredStarsFieldSchema } from "@/lib/validation/common";
import { gameSlugSchema } from "@/lib/validation/games";

// Mirrors reviews.body's CHECK (1-10000 chars).
export const reviewBodySchema = z
  .string()
  .trim()
  .min(1, "Write something before publishing.")
  .max(10000, "Review must be 10,000 characters or fewer.");

// A distinct schema, not reused from reviewBodySchema — review_comments.body
// has its own, much smaller CHECK (1-2000 chars).
export const reviewCommentBodySchema = z
  .string()
  .trim()
  .min(1, "Write something before posting.")
  .max(2000, "Comment must be 2000 characters or fewer.");

export const createReviewSchema = z.object({
  gameId: uuidSchema,
  gameSlug: gameSlugSchema,
  rating: requiredStarsFieldSchema,
  body: reviewBodySchema,
  hasSpoilers: z.boolean(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

// Never includes gameId — reviews has no UPDATE grant on game_id.
export const updateReviewSchema = z.object({
  reviewId: uuidSchema,
  gameSlug: gameSlugSchema,
  rating: requiredStarsFieldSchema,
  body: reviewBodySchema,
  hasSpoilers: z.boolean(),
});
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

export const deleteReviewSchema = z.object({
  reviewId: uuidSchema,
  gameSlug: gameSlugSchema,
});
export type DeleteReviewInput = z.infer<typeof deleteReviewSchema>;

// Validated as the very first thing toggleReviewLikeAction does, before any
// Supabase call — it's invoked directly with plain arguments from a client
// transition, not parsed FormData, so it's not automatically safe just
// because the TypeScript signature looks typed.
export const toggleReviewLikeSchema = z.object({
  reviewId: uuidSchema,
  nextLiked: z.boolean(),
  gameSlug: gameSlugSchema.nullable(),
});
export type ToggleReviewLikeInput = z.infer<typeof toggleReviewLikeSchema>;

export const createReviewCommentSchema = z.object({
  reviewId: uuidSchema,
  body: reviewCommentBodySchema,
});
export type CreateReviewCommentInput = z.infer<
  typeof createReviewCommentSchema
>;

export const updateReviewCommentSchema = z.object({
  commentId: uuidSchema,
  reviewId: uuidSchema,
  body: reviewCommentBodySchema,
});
export type UpdateReviewCommentInput = z.infer<
  typeof updateReviewCommentSchema
>;

export const deleteReviewCommentSchema = z.object({
  commentId: uuidSchema,
  reviewId: uuidSchema,
});
export type DeleteReviewCommentInput = z.infer<
  typeof deleteReviewCommentSchema
>;
