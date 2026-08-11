"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActionError } from "@/server/actions/log-action-error";
import {
  createReviewSchema,
  updateReviewSchema,
  deleteReviewSchema,
  toggleReviewLikeSchema,
  createReviewCommentSchema,
  updateReviewCommentSchema,
  deleteReviewCommentSchema,
} from "@/lib/validation/reviews";
import { starsToRating } from "@/lib/rating";
import type { ActionState } from "@/lib/action-state";

export interface ToggleLikeResult {
  status: "success" | "error";
  liked: boolean;
  likeCount?: number;
  message?: string;
}

function friendlyReviewError(error: {
  code?: string;
  message: string;
}): string {
  if (error.code === "23505") {
    return "You already have a review for this game — edit it instead.";
  }
  return "Something went wrong saving your review. Please try again.";
}

/**
 * This review's rating is an independent snapshot — "what I rated it in
 * this review" — and is never written to user_games.rating. See the
 * rating-semantics invariant in docs/SOCIAL.md.
 */
export async function createReviewAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const rate = checkRateLimit(`review-create:${user.id}`, {
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      message: "Too many reviews submitted. Please wait a bit and try again.",
    };
  }

  const parsed = createReviewSchema.safeParse({
    gameId: formData.get("gameId"),
    gameSlug: formData.get("gameSlug"),
    rating: formData.get("rating"),
    body: formData.get("body"),
    hasSpoilers: formData.get("hasSpoilers") === "on",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Defensive backstop: the composer normally renders in edit mode once a
  // review exists, so a 23505 here means a stale tab / resubmitted form.
  const { error } = await supabase.from("reviews").insert({
    game_id: parsed.data.gameId,
    rating: starsToRating(parsed.data.rating),
    body: parsed.data.body,
    has_spoilers: parsed.data.hasSpoilers,
  });

  if (error) {
    logActionError("createReviewAction", error);
    return { status: "error", message: friendlyReviewError(error) };
  }

  revalidatePath(`/games/${parsed.data.gameSlug}`);
  return { status: "success", message: "Review published." };
}

export async function updateReviewAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = updateReviewSchema.safeParse({
    reviewId: formData.get("reviewId"),
    gameSlug: formData.get("gameSlug"),
    rating: formData.get("rating"),
    body: formData.get("body"),
    hasSpoilers: formData.get("hasSpoilers") === "on",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("reviews")
    .update({
      rating: starsToRating(parsed.data.rating),
      body: parsed.data.body,
      has_spoilers: parsed.data.hasSpoilers,
    })
    .eq("id", parsed.data.reviewId)
    .eq("user_id", user.id);

  if (error) {
    logActionError("updateReviewAction", error);
    return { status: "error", message: friendlyReviewError(error) };
  }

  // Deliberately does NOT touch user_games — editing a review never moves
  // the game's aggregate score. See the rating-semantics invariant.
  revalidatePath(`/games/${parsed.data.gameSlug}`);
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return { status: "success", message: "Review updated." };
}

export async function deleteReviewAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = deleteReviewSchema.safeParse({
    reviewId: formData.get("reviewId"),
    gameSlug: formData.get("gameSlug"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const { data, error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", parsed.data.reviewId)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    logActionError("deleteReviewAction", error);
    return { status: "error", message: friendlyReviewError(error) };
  }
  if (!data || data.length === 0) {
    // RLS silently filtered the row (not the owner) or it was already
    // deleted — indistinguishable from "nothing happened." Never redirect
    // on a delete that didn't actually affect a row.
    logActionError("deleteReviewAction", {
      code: "no_rows_affected",
      message: "delete matched zero rows",
    });
    return {
      status: "error",
      message: "Couldn't delete that review. Please try again.",
    };
  }

  revalidatePath(`/games/${parsed.data.gameSlug}`);
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  redirect(`/games/${parsed.data.gameSlug}`);
}

/**
 * Called directly from a client startTransition, not via a <form> — a
 * "use server" export is a real callable network endpoint regardless of its
 * TypeScript parameter types, so the very first thing this function does is
 * validate its actual runtime arguments against toggleReviewLikeSchema,
 * before any Supabase call and before checking auth.
 */
export async function toggleReviewLikeAction(
  reviewId: string,
  nextLiked: boolean,
  gameSlug: string | null,
): Promise<ToggleLikeResult> {
  const parsed = toggleReviewLikeSchema.safeParse({
    reviewId,
    nextLiked,
    gameSlug,
  });
  if (!parsed.success) {
    return { status: "error", liked: false, message: "Invalid request." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Deliberately does NOT call requireUser (which redirects) — ReviewCard
  // never renders this control for a signed-out viewer, and a background
  // redirect from a like click would be jarring.
  if (!user) {
    return {
      status: "error",
      liked: false,
      message: "Sign in to like reviews.",
    };
  }

  const rate = checkRateLimit(`like-toggle:${user.id}`, {
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      liked: !parsed.data.nextLiked,
      message: "Too many requests. Please wait a bit and try again.",
    };
  }

  if (parsed.data.nextLiked) {
    const { error } = await supabase
      .from("review_likes")
      .insert({ review_id: parsed.data.reviewId });
    // A 23505 (already liked) is treated as success — the composite PK is
    // the only guard needed to prevent a duplicate like, gracefully.
    if (error && error.code !== "23505") {
      logActionError("toggleReviewLikeAction:like", error);
      return {
        status: "error",
        liked: false,
        message: "Couldn't like this review. Please try again.",
      };
    }
  } else {
    const { error } = await supabase
      .from("review_likes")
      .delete()
      .eq("user_id", user.id)
      .eq("review_id", parsed.data.reviewId);
    // Deleting 0 rows (already unliked) is naturally idempotent, not an error.
    if (error) {
      logActionError("toggleReviewLikeAction:unlike", error);
      return {
        status: "error",
        liked: true,
        message: "Couldn't unlike this review. Please try again.",
      };
    }
  }

  const { data: countRow } = await supabase
    .from("review_like_counts")
    .select("like_count")
    .eq("review_id", parsed.data.reviewId)
    .maybeSingle();

  if (parsed.data.gameSlug) {
    revalidatePath(`/games/${parsed.data.gameSlug}`);
  }
  revalidatePath(`/reviews/${parsed.data.reviewId}`);

  return {
    status: "success",
    liked: parsed.data.nextLiked,
    likeCount: countRow?.like_count ?? 0,
  };
}

export async function createReviewCommentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const rate = checkRateLimit(`comment-create:${user.id}`, {
    limit: 60,
    windowSeconds: 60 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      message: "Too many comments submitted. Please wait a bit and try again.",
    };
  }

  const parsed = createReviewCommentSchema.safeParse({
    reviewId: formData.get("reviewId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("review_comments")
    .insert({ review_id: parsed.data.reviewId, body: parsed.data.body });

  if (error) {
    logActionError("createReviewCommentAction", error);
    return {
      status: "error",
      message: "Couldn't post your comment. Please try again.",
    };
  }

  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return { status: "success", message: "Comment posted." };
}

export async function updateReviewCommentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = updateReviewCommentSchema.safeParse({
    commentId: formData.get("commentId"),
    reviewId: formData.get("reviewId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("review_comments")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.commentId)
    .eq("user_id", user.id);

  if (error) {
    logActionError("updateReviewCommentAction", error);
    return {
      status: "error",
      message: "Couldn't update your comment. Please try again.",
    };
  }

  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return { status: "success", message: "Comment updated." };
}

export async function deleteReviewCommentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = deleteReviewCommentSchema.safeParse({
    commentId: formData.get("commentId"),
    reviewId: formData.get("reviewId"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid request." };
  }

  const { error } = await supabase
    .from("review_comments")
    .delete()
    .eq("id", parsed.data.commentId)
    .eq("user_id", user.id);

  if (error) {
    logActionError("deleteReviewCommentAction", error);
    return {
      status: "error",
      message: "Couldn't delete your comment. Please try again.",
    };
  }

  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return { status: "success", message: "Comment deleted." };
}
