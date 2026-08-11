"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { logActionError } from "@/server/actions/log-action-error";
import {
  setGameStatusSchema,
  rateGameSchema,
  clearRatingSchema,
  removeFromLibrarySchema,
} from "@/lib/validation/library";
import { starsToRating } from "@/lib/rating";
import type { ActionState } from "@/lib/action-state";

function friendlyLibraryError(): string {
  return "Something went wrong updating your library. Please try again.";
}

function revalidateLibraryPaths(gameSlug: string) {
  revalidatePath(`/games/${gameSlug}`);
  revalidatePath("/library");
}

/**
 * Deliberately not an upsert. `.upsert(..., {onConflict: "user_id,game_id"})`
 * is unsafe against this table's own grants: Supabase's merge-duplicates
 * upsert builds its DO UPDATE SET clause from every column present in the
 * payload, including `game_id` (needed as the conflict-target value) — but
 * `game_id` was deliberately never granted UPDATE (see docs/DATABASE.md),
 * so that statement can fail on a column-privilege check even though the
 * value being "set" is unchanged. Instead: try the update first (never
 * touches `rating` — see the rating-semantics invariant in docs/SOCIAL.md);
 * if no row existed yet, insert; if a concurrent request already inserted
 * in that gap (23505), retry the update so *this* request's own requested
 * status still wins, rather than assuming the race means success.
 */
export async function setGameStatusAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = setGameStatusSchema.safeParse({
    gameId: formData.get("gameId"),
    gameSlug: formData.get("gameSlug"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please choose a valid status.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { gameId, gameSlug, status } = parsed.data;

  const runUpdate = () =>
    supabase
      .from("user_games")
      .update({ status })
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .select("id");

  const { data: updated, error: updateError } = await runUpdate();
  if (updateError) {
    logActionError("setGameStatusAction:update", updateError);
    return { status: "error", message: friendlyLibraryError() };
  }
  if (updated.length > 0) {
    revalidateLibraryPaths(gameSlug);
    return { status: "success", message: "Status updated." };
  }

  // No existing row — first time adding this game to the library.
  const { error: insertError } = await supabase
    .from("user_games")
    .insert({ game_id: gameId, status });

  if (!insertError) {
    revalidateLibraryPaths(gameSlug);
    return { status: "success", message: "Status updated." };
  }

  if (insertError.code === "23505") {
    // A concurrent request created the row first, in the gap between our
    // update and insert. Don't assume that request's status "won" — retry
    // the update with the status *this* request asked for.
    const { data: retried, error: retryError } = await runUpdate();
    if (retryError) {
      logActionError("setGameStatusAction:retry-update", retryError);
      return { status: "error", message: friendlyLibraryError() };
    }
    if (retried.length > 0) {
      revalidateLibraryPaths(gameSlug);
      return { status: "success", message: "Status updated." };
    }
    return { status: "error", message: friendlyLibraryError() };
  }

  logActionError("setGameStatusAction:insert", insertError);
  return { status: "error", message: friendlyLibraryError() };
}

export async function clearRatingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = clearRatingSchema.safeParse({
    gameId: formData.get("gameId"),
    gameSlug: formData.get("gameSlug"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const { error } = await supabase
    .from("user_games")
    .update({ rating: null })
    .eq("user_id", user.id)
    .eq("game_id", parsed.data.gameId);

  if (error) {
    logActionError("clearRatingAction", error);
    return { status: "error", message: friendlyLibraryError() };
  }

  revalidateLibraryPaths(parsed.data.gameSlug);
  return { status: "success", message: "Rating cleared." };
}

/**
 * A plain UPDATE, never an upsert — the rating control is disabled in the UI
 * until a user_games row exists (see game-action-panel.tsx). Zero rows
 * affected (the row was removed between page load and submit) returns a
 * friendly message rather than guessing a default status.
 */
export async function rateGameAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = rateGameSchema.safeParse({
    gameId: formData.get("gameId"),
    gameSlug: formData.get("gameSlug"),
    stars: formData.get("stars"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid rating.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const rating = starsToRating(parsed.data.stars);
  const { data, error } = await supabase
    .from("user_games")
    .update({ rating })
    .eq("user_id", user.id)
    .eq("game_id", parsed.data.gameId)
    .select("id");

  if (error) {
    logActionError("rateGameAction", error);
    return { status: "error", message: friendlyLibraryError() };
  }
  if (!data || data.length === 0) {
    return {
      status: "error",
      message: "Add this game to your library before rating it.",
    };
  }

  revalidateLibraryPaths(parsed.data.gameSlug);
  return { status: "success", message: "Rating saved." };
}

/**
 * Never cascades to diary entries or reviews — there's no FK from either to
 * user_games, deliberately, so removing a game from the library never wipes
 * a user's diary/review history for it.
 */
export async function removeFromLibraryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = removeFromLibrarySchema.safeParse({
    gameId: formData.get("gameId"),
    gameSlug: formData.get("gameSlug"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const { error } = await supabase
    .from("user_games")
    .delete()
    .eq("user_id", user.id)
    .eq("game_id", parsed.data.gameId);

  if (error) {
    logActionError("removeFromLibraryAction", error);
    return { status: "error", message: friendlyLibraryError() };
  }

  revalidateLibraryPaths(parsed.data.gameSlug);
  return { status: "success", message: "Removed from library." };
}
