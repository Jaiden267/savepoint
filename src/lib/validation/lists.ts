import { z } from "zod";
import { uuidSchema } from "@/lib/validation/common";
import { usernameSchema } from "@/lib/validation/auth";

/** Mirrors lists.visibility's CHECK (public/unlisted/private). */
export const listVisibilitySchema = z.enum(["public", "unlisted", "private"]);
export type ListVisibility = z.infer<typeof listVisibilitySchema>;

// Mirrors lists.title's CHECK (1-200 chars).
export const listTitleSchema = z
  .string()
  .trim()
  .min(1, "Give this list a title.")
  .max(200, "Title must be 200 characters or fewer.");

// Mirrors lists.description's CHECK (<=2000 chars, nullable).
export const listDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be 2000 characters or fewer.")
  .nullable();

// Mirrors list_items.note's CHECK (<=1000 chars, nullable).
export const listItemNoteSchema = z
  .string()
  .trim()
  .max(1000, "Note must be 1000 characters or fewer.")
  .nullable();

export const createListSchema = z.object({
  title: listTitleSchema,
  description: listDescriptionSchema,
  visibility: listVisibilitySchema,
  isRanked: z.boolean(),
});
export type CreateListInput = z.infer<typeof createListSchema>;

// Never includes userId — lists has no UPDATE grant on user_id.
export const updateListSchema = z.object({
  listId: uuidSchema,
  title: listTitleSchema,
  description: listDescriptionSchema,
  visibility: listVisibilitySchema,
  isRanked: z.boolean(),
});
export type UpdateListInput = z.infer<typeof updateListSchema>;

// `ownerUsername` is never used to authorize the delete (ownership is
// enforced by `.eq("user_id", user.id)` in the action, backed by RLS) —
// it's only the redirect target once the list is gone, supplied by the
// page (which already knows its own username) rather than looked up again.
export const deleteListSchema = z.object({
  listId: uuidSchema,
  ownerUsername: usernameSchema,
});
export type DeleteListInput = z.infer<typeof deleteListSchema>;

/**
 * `igdbId` (not an internal game uuid) — the client never has the internal
 * id for a not-yet-imported IGDB result, only its IGDB id/slug (see
 * src/components/search/search-command-dialog.tsx's SearchResultItem
 * shape). The action resolves/imports the local `games` row from this via
 * the existing `importGameByIgdbId()`, exactly like `/games/[slug]`'s
 * on-view import path. Position is never client-supplied — the action
 * always appends at the current max position + 1.
 */
export const addListItemSchema = z.object({
  listId: uuidSchema,
  igdbId: z.number().int().positive(),
});
export type AddListItemInput = z.infer<typeof addListItemSchema>;

export const removeListItemSchema = z.object({
  listId: uuidSchema,
  itemId: uuidSchema,
});
export type RemoveListItemInput = z.infer<typeof removeListItemSchema>;

export const updateListItemNoteSchema = z.object({
  listId: uuidSchema,
  itemId: uuidSchema,
  note: listItemNoteSchema,
});
export type UpdateListItemNoteInput = z.infer<typeof updateListItemNoteSchema>;

/**
 * The full, ordered set of item ids for a ranked list's new order. Server
 * side (reorderListItemsAction / the reorder_list_items RPC) still verifies
 * this is exactly the list's current item set — this schema only checks
 * shape (non-empty array of uuids), not membership.
 */
export const reorderListItemsSchema = z.object({
  listId: uuidSchema,
  itemIds: z.array(uuidSchema).min(1),
});
export type ReorderListItemsInput = z.infer<typeof reorderListItemsSchema>;
