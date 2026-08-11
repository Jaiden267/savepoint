"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActionError } from "@/server/actions/log-action-error";
import { toggleFollowSchema } from "@/lib/validation/follows";

export interface ToggleFollowResult {
  status: "success" | "error";
  following: boolean;
  followerCount?: number;
  message?: string;
}

/**
 * Called directly from FollowButton's client transition, not via `<form>` —
 * same discipline as toggleReviewLikeAction: validate raw runtime args
 * before any auth check or database call. `follows` has no UPDATE
 * grant/policy at all (a follow is created or removed, never edited), so
 * this is always a plain insert-or-delete.
 */
export async function toggleFollowAction(
  targetUserId: string,
  nextFollowing: boolean,
  targetUsername: string | null,
): Promise<ToggleFollowResult> {
  const parsed = toggleFollowSchema.safeParse({
    targetUserId,
    nextFollowing,
  });
  if (!parsed.success) {
    return { status: "error", following: false, message: "Invalid request." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Deliberately does NOT redirect (unlike requireUser) — FollowButton
  // never renders this control for a signed-out viewer, and a background
  // redirect from a follow click would be jarring.
  if (!user) {
    return {
      status: "error",
      following: false,
      message: "Sign in to follow users.",
    };
  }

  if (user.id === parsed.data.targetUserId) {
    return {
      status: "error",
      following: false,
      message: "You can't follow yourself.",
    };
  }

  const rate = checkRateLimit(`follow-toggle:${user.id}`, {
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      following: !parsed.data.nextFollowing,
      message: "Too many requests. Please wait a bit and try again.",
    };
  }

  if (parsed.data.nextFollowing) {
    const { error } = await supabase
      .from("follows")
      .insert({ following_id: parsed.data.targetUserId });
    // A 23505 (already following) is treated as success — the
    // (follower_id, following_id) unique constraint is the only guard
    // needed to prevent a duplicate follow, gracefully.
    if (error && error.code !== "23505") {
      logActionError("toggleFollowAction:follow", error);
      return {
        status: "error",
        following: false,
        message: "Couldn't follow this user. Please try again.",
      };
    }
  } else {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("following_id", parsed.data.targetUserId);
    // Deleting 0 rows (already not following) is naturally idempotent, not an error.
    if (error) {
      logActionError("toggleFollowAction:unfollow", error);
      return {
        status: "error",
        following: true,
        message: "Couldn't unfollow this user. Please try again.",
      };
    }
  }

  const { count } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("following_id", parsed.data.targetUserId);

  if (targetUsername) {
    revalidatePath(`/users/${targetUsername}`);
    revalidatePath(`/users/${targetUsername}/followers`);
  }

  return {
    status: "success",
    following: parsed.data.nextFollowing,
    followerCount: count ?? 0,
  };
}
