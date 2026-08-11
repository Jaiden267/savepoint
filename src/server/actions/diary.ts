"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { logActionError } from "@/server/actions/log-action-error";
import {
  logDiaryEntrySchema,
  updateDiaryEntrySchema,
  deleteDiaryEntrySchema,
} from "@/lib/validation/diary";
import { starsToRating } from "@/lib/rating";
import type { ActionState } from "@/lib/action-state";

function friendlyDiaryError(): string {
  return "Something went wrong saving your diary entry. Please try again.";
}

function revalidateDiaryPaths(gameSlug: string) {
  revalidatePath("/diary");
  revalidatePath(`/games/${gameSlug}`);
}

/**
 * This entry's rating is an independent snapshot — "what I rated it for
 * this playthrough" — and is never written to user_games.rating. See the
 * rating-semantics invariant in docs/SOCIAL.md.
 */
export async function logDiaryEntryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  await requireUser(supabase);

  const parsed = logDiaryEntrySchema.safeParse({
    gameId: formData.get("gameId"),
    gameSlug: formData.get("gameSlug"),
    playedOn: formData.get("playedOn"),
    rating: formData.get("rating"),
    isReplay: formData.get("isReplay") === "on",
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase.from("diary_entries").insert({
    game_id: parsed.data.gameId,
    played_on: parsed.data.playedOn,
    rating:
      parsed.data.rating === null ? null : starsToRating(parsed.data.rating),
    is_replay: parsed.data.isReplay,
    note: parsed.data.note,
  });

  if (error) {
    logActionError("logDiaryEntryAction", error);
    return { status: "error", message: friendlyDiaryError() };
  }

  revalidateDiaryPaths(parsed.data.gameSlug);
  return { status: "success", message: "Diary entry logged." };
}

// Never touches game_id — diary_entries has no UPDATE grant on that column,
// and an "edit" must never attempt to reassign which game an entry is for.
export async function updateDiaryEntryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = updateDiaryEntrySchema.safeParse({
    entryId: formData.get("entryId"),
    gameSlug: formData.get("gameSlug"),
    playedOn: formData.get("playedOn"),
    rating: formData.get("rating"),
    isReplay: formData.get("isReplay") === "on",
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("diary_entries")
    .update({
      played_on: parsed.data.playedOn,
      rating:
        parsed.data.rating === null ? null : starsToRating(parsed.data.rating),
      is_replay: parsed.data.isReplay,
      note: parsed.data.note,
    })
    .eq("id", parsed.data.entryId)
    .eq("user_id", user.id);

  if (error) {
    logActionError("updateDiaryEntryAction", error);
    return { status: "error", message: friendlyDiaryError() };
  }

  revalidateDiaryPaths(parsed.data.gameSlug);
  return { status: "success", message: "Diary entry updated." };
}

export async function deleteDiaryEntryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = deleteDiaryEntrySchema.safeParse({
    entryId: formData.get("entryId"),
    gameSlug: formData.get("gameSlug"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const { error } = await supabase
    .from("diary_entries")
    .delete()
    .eq("id", parsed.data.entryId)
    .eq("user_id", user.id);

  if (error) {
    logActionError("deleteDiaryEntryAction", error);
    return { status: "error", message: friendlyDiaryError() };
  }

  revalidateDiaryPaths(parsed.data.gameSlug);
  return { status: "success", message: "Diary entry deleted." };
}
