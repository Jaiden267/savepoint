"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActionError } from "@/server/actions/log-action-error";
import { importGameByIgdbId } from "@/server/services/game-sync";
import { syncGameVector } from "@/lib/pinecone/sync";
import {
  createListSchema,
  updateListSchema,
  deleteListSchema,
  addListItemSchema,
  removeListItemSchema,
  updateListItemNoteSchema,
  reorderListItemsSchema,
} from "@/lib/validation/lists";
import type { ActionState } from "@/lib/action-state";

const LIST_ITEM_IMPORT_RATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 };

function friendlyListError(): string {
  return "Something went wrong updating this list. Please try again.";
}

function revalidateListPaths(listId: string) {
  revalidatePath(`/lists/${listId}`);
  revalidatePath(`/lists/${listId}/edit`);
}

export async function createListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  await requireUser(supabase);

  const parsed = createListSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || null,
    visibility: formData.get("visibility"),
    isRanked: formData.get("isRanked") === "on",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { data, error } = await supabase
    .from("lists")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description,
      visibility: parsed.data.visibility,
      is_ranked: parsed.data.isRanked,
    })
    .select("id")
    .single();

  if (error || !data) {
    logActionError(
      "createListAction",
      error ?? { message: "insert returned no row" },
    );
    return { status: "error", message: friendlyListError() };
  }

  redirect(`/lists/${data.id}`);
}

// Never includes userId — lists has no UPDATE grant on user_id, and an
// "edit" must never attempt to reassign list ownership.
export async function updateListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = updateListSchema.safeParse({
    listId: formData.get("listId"),
    title: formData.get("title"),
    description: formData.get("description") || null,
    visibility: formData.get("visibility"),
    isRanked: formData.get("isRanked") === "on",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("lists")
    .update({
      title: parsed.data.title,
      description: parsed.data.description,
      visibility: parsed.data.visibility,
      is_ranked: parsed.data.isRanked,
    })
    .eq("id", parsed.data.listId)
    .eq("user_id", user.id);

  if (error) {
    logActionError("updateListAction", error);
    return { status: "error", message: friendlyListError() };
  }

  revalidateListPaths(parsed.data.listId);
  return { status: "success", message: "List updated." };
}

export async function deleteListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = deleteListSchema.safeParse({
    listId: formData.get("listId"),
    ownerUsername: formData.get("ownerUsername"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const { data, error } = await supabase
    .from("lists")
    .delete()
    .eq("id", parsed.data.listId)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    logActionError("deleteListAction", error);
    return { status: "error", message: friendlyListError() };
  }
  if (!data || data.length === 0) {
    // RLS silently filtered the row (not the owner) or it was already
    // deleted — indistinguishable from "nothing happened." Never redirect
    // on a delete that didn't actually affect a row.
    logActionError("deleteListAction", {
      code: "no_rows_affected",
      message: "delete matched zero rows",
    });
    return {
      status: "error",
      message: "Couldn't delete that list. Please try again.",
    };
  }

  redirect(`/users/${parsed.data.ownerUsername}/lists`);
}

export interface AddListItemResult {
  status: "success" | "error";
  message?: string;
  item?: {
    id: string;
    gameId: string;
    gameSlug: string;
    gameName: string;
    coverImageId: string | null;
    releaseYear: number | null;
    position: number;
    note: string | null;
  };
}

/**
 * Called directly from the add-game-to-list dialog's selection handler
 * (a client transition), not via `<form>` — same discipline as
 * toggleReviewLikeAction: validate raw runtime args before any auth check
 * or database call. `igdbId`, not an internal game id, since the client
 * never has an internal id for a not-yet-imported IGDB search result.
 * Imports the game (idempotent, existing-and-fresh short-circuits with no
 * IGDB call — see game-sync.ts) before inserting the list_items row. Rate
 * limited independently of `/games/[slug]`'s own import gate, since this is
 * a second path that can trigger an IGDB call.
 */
export async function addListItemAction(
  listId: string,
  igdbId: number,
): Promise<AddListItemResult> {
  const parsed = addListItemSchema.safeParse({ listId, igdbId });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: "Sign in to edit this list." };
  }

  const rate = checkRateLimit(
    `list-item-import:${user.id}`,
    LIST_ITEM_IMPORT_RATE_LIMIT,
  );
  if (!rate.allowed) {
    return {
      status: "error",
      message:
        "Too many games added recently. Please wait a bit and try again.",
    };
  }

  let game;
  try {
    game = await importGameByIgdbId(parsed.data.igdbId);
  } catch (err) {
    logActionError("addListItemAction:import", {
      message: err instanceof Error ? err.message : "import failed",
    });
    return {
      status: "error",
      message: "Couldn't add that game right now. Please try again.",
    };
  }

  // Best-effort, non-blocking — never delays or fails this action if
  // Pinecone is unavailable. Server Actions never execute during
  // `next build`, so this is a confirmed live request context.
  after(() => {
    syncGameVector(game.id).catch(() => {});
  });

  const { data: maxPositionRow } = await supabase
    .from("list_items")
    .select("position")
    .eq("list_id", parsed.data.listId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxPositionRow?.position ?? 0) + 1;

  const { data, error } = await supabase
    .from("list_items")
    .insert({
      list_id: parsed.data.listId,
      game_id: game.id,
      position: nextPosition,
    })
    .select("id, position, note")
    .single();

  if (error || !data) {
    // 23505 covers two distinct constraints here: the game is already on
    // this list (list_items_list_game_key — the common, user-facing case),
    // or a rare concurrent-add race on the position value
    // (list_items_list_position_key — no automatic retry; asking the user
    // to try again is an acceptable outcome for this narrow a race).
    if (error?.code === "23505" && error.message.includes("list_game")) {
      return { status: "error", message: "This game is already on the list." };
    }
    logActionError(
      "addListItemAction:insert",
      error ?? { message: "insert returned no row" },
    );
    return {
      status: "error",
      message: "Couldn't add that game to the list. Please try again.",
    };
  }

  revalidateListPaths(parsed.data.listId);

  return {
    status: "success",
    item: {
      id: data.id,
      gameId: game.id,
      gameSlug: game.slug,
      gameName: game.name,
      coverImageId: game.cover_image_id,
      releaseYear: game.release_date
        ? new Date(game.release_date).getUTCFullYear()
        : null,
      position: data.position,
      note: data.note,
    },
  };
}

export async function removeListItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  await requireUser(supabase);

  const parsed = removeListItemSchema.safeParse({
    listId: formData.get("listId"),
    itemId: formData.get("itemId"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  // Ownership is enforced by RLS (owner of the parent list) — list_items
  // has no user_id column of its own to filter on directly here.
  const { error } = await supabase
    .from("list_items")
    .delete()
    .eq("id", parsed.data.itemId)
    .eq("list_id", parsed.data.listId);

  if (error) {
    logActionError("removeListItemAction", error);
    return { status: "error", message: friendlyListError() };
  }

  revalidateListPaths(parsed.data.listId);
  return { status: "success", message: "Removed from list." };
}

export async function updateListItemNoteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  await requireUser(supabase);

  const parsed = updateListItemNoteSchema.safeParse({
    listId: formData.get("listId"),
    itemId: formData.get("itemId"),
    note: formData.get("note") || null,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("list_items")
    .update({ note: parsed.data.note })
    .eq("id", parsed.data.itemId)
    .eq("list_id", parsed.data.listId);

  if (error) {
    logActionError("updateListItemNoteAction", error);
    return { status: "error", message: friendlyListError() };
  }

  revalidateListPaths(parsed.data.listId);
  return { status: "success", message: "Note updated." };
}

export interface ReorderListItemsResult {
  status: "success" | "error";
  message?: string;
}

/**
 * Called directly from the reorder controls (a client transition, since it
 * submits a whole ordered id array rather than a single field) — validates
 * raw args first, same discipline as every other transition-invoked action
 * here. Delegates the actual reorder to the `reorder_list_items` database
 * function (migration 19) — one atomic call, `security invoker` so it runs
 * under this same request's RLS and cannot bypass it. That function itself
 * re-validates ownership and that the submitted id set exactly matches the
 * list's current items, so this action doesn't duplicate those checks.
 */
export async function reorderListItemsAction(
  listId: string,
  itemIds: string[],
): Promise<ReorderListItemsResult> {
  const parsed = reorderListItemsSchema.safeParse({ listId, itemIds });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: "Sign in to reorder this list." };
  }

  const { error } = await supabase.rpc("reorder_list_items", {
    p_list_id: parsed.data.listId,
    p_item_ids: parsed.data.itemIds,
  });

  if (error) {
    logActionError("reorderListItemsAction", error);
    return {
      status: "error",
      message: "Couldn't save the new order. Please refresh and try again.",
    };
  }

  revalidateListPaths(parsed.data.listId);
  return { status: "success" };
}
