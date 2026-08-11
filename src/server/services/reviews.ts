import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars } from "@/lib/rating";
import type {
  ReviewCardData,
  ReviewCardAuthor,
} from "@/components/reviews/review-card";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface ReviewCommentDetail {
  id: string;
  body: string;
  createdAt: string;
  author: ReviewCardAuthor;
  isOwner: boolean;
}

export interface ReviewDetail {
  review: ReviewCardData;
  author: ReviewCardAuthor;
  likeCount: number;
  viewerHasLiked: boolean;
  isOwnReview: boolean;
  comments: ReviewCommentDetail[];
}

function avatarUrl(
  supabase: SupabaseClient,
  avatarPath: string | null,
): string | null {
  if (!avatarPath) return null;
  return supabase.storage.from("avatars").getPublicUrl(avatarPath).data
    .publicUrl;
}

/**
 * Everything the /reviews/[id] permalink needs, batched the same way
 * game-social.ts's Tier 2 hydration does — never one query per comment row.
 * Uses the session-scoped client (never admin.ts) — reviews/comments/
 * profiles are all public-read per RLS, so a signed-out visitor gets the
 * full page. `viewerId` is optional: only the viewer's-own-like lookup is
 * conditioned on it — the review, author, like count, and comments are
 * fetched unconditionally so a signed-out page render is never blocked.
 */
export async function getReviewDetail(
  reviewId: string,
  viewerId?: string | null,
): Promise<ReviewDetail | null> {
  const supabase = await createClient();

  const { data: reviewRow } = await supabase
    .from("reviews")
    .select(
      "id, user_id, rating, body, has_spoilers, created_at, games!inner(slug)",
    )
    .eq("id", reviewId)
    .maybeSingle();

  if (!reviewRow) return null;

  const [profileResult, likeCountResult, viewerLikeResult, commentsResult] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("username, display_name, avatar_path")
        .eq("id", reviewRow.user_id)
        .maybeSingle(),
      supabase
        .from("review_like_counts")
        .select("like_count")
        .eq("review_id", reviewId)
        .maybeSingle(),
      viewerId
        ? supabase
            .from("review_likes")
            .select("review_id")
            .eq("user_id", viewerId)
            .eq("review_id", reviewId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("review_comments")
        .select("id, body, created_at, user_id")
        .eq("review_id", reviewId)
        .order("created_at", { ascending: true })
        .limit(200),
    ]);

  const author: ReviewCardAuthor = {
    username: profileResult.data?.username ?? "unknown",
    displayName: profileResult.data?.display_name ?? null,
    avatarUrl: avatarUrl(supabase, profileResult.data?.avatar_path ?? null),
  };

  const commentRows = commentsResult.data ?? [];
  const commentAuthorIds = Array.from(
    new Set(commentRows.map((comment) => comment.user_id)),
  );

  const { data: commentProfiles } =
    commentAuthorIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_path")
          .in("id", commentAuthorIds)
      : {
          data: [] as {
            id: string;
            username: string;
            display_name: string | null;
            avatar_path: string | null;
          }[],
        };

  const commentProfilesById = new Map(
    (commentProfiles ?? []).map((profile) => [profile.id, profile]),
  );

  const comments: ReviewCommentDetail[] = commentRows.map((row) => {
    const profile = commentProfilesById.get(row.user_id);
    return {
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: {
        username: profile?.username ?? "unknown",
        displayName: profile?.display_name ?? null,
        avatarUrl: avatarUrl(supabase, profile?.avatar_path ?? null),
      },
      isOwner: viewerId != null && row.user_id === viewerId,
    };
  });

  return {
    review: {
      id: reviewRow.id,
      rating: ratingToStars(reviewRow.rating),
      body: reviewRow.body,
      hasSpoilers: reviewRow.has_spoilers,
      createdAt: reviewRow.created_at,
      gameSlug: reviewRow.games.slug,
    },
    author,
    likeCount: likeCountResult.data?.like_count ?? 0,
    viewerHasLiked: Boolean(viewerLikeResult.data),
    isOwnReview: viewerId != null && reviewRow.user_id === viewerId,
    comments,
  };
}
