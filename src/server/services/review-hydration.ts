import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars } from "@/lib/rating";
import { avatarUrl } from "@/server/services/avatar";
import type {
  ReviewCardData,
  ReviewCardAuthor,
} from "@/components/reviews/review-card";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface RawReviewRow {
  id: string;
  user_id: string;
  rating: number;
  body: string;
  has_spoilers: boolean;
  created_at: string;
}

export interface HydratedReview {
  review: ReviewCardData;
  author: ReviewCardAuthor;
  likeCount: number;
  viewerHasLiked: boolean;
}

/**
 * Batched author + review_like_counts + viewer's-own-like hydration for a
 * set of review rows — never one query per review row. Shared by
 * game-social.ts (a single game's recent reviews, all sharing one game
 * slug), discovery.ts (recent public reviews across many games), and
 * activity-feed.ts (review_published snippet hydration). `gameSlugFor` lets
 * a single-game caller pass a constant while a cross-game caller passes a
 * per-row lookup, without this function needing to know the difference.
 */
export async function hydrateReviews(
  supabase: SupabaseClient,
  rawReviews: RawReviewRow[],
  gameSlugFor: (review: RawReviewRow) => string,
  viewerId: string | null,
): Promise<HydratedReview[]> {
  if (rawReviews.length === 0) return [];

  const reviewIds = rawReviews.map((review) => review.id);
  const authorIds = Array.from(
    new Set(rawReviews.map((review) => review.user_id)),
  );

  const [profilesResult, likeCountsResult, viewerLikesResult] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, display_name, avatar_path")
        .in("id", authorIds),
      supabase
        .from("review_like_counts")
        .select("review_id, like_count")
        .in("review_id", reviewIds),
      viewerId
        ? supabase
            .from("review_likes")
            .select("review_id")
            .eq("user_id", viewerId)
            .in("review_id", reviewIds)
        : Promise.resolve({ data: [] }),
    ]);

  const profilesById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile]),
  );
  const likeCountByReviewId = new Map(
    (likeCountsResult.data ?? []).map((row) => [
      row.review_id,
      row.like_count ?? 0,
    ]),
  );
  const likedReviewIds = new Set(
    (viewerLikesResult.data ?? []).map((row) => row.review_id),
  );

  return rawReviews.map((raw) => {
    const profile = profilesById.get(raw.user_id);
    const author: ReviewCardAuthor = {
      username: profile?.username ?? "unknown",
      displayName: profile?.display_name ?? null,
      avatarUrl: avatarUrl(supabase, profile?.avatar_path ?? null),
    };
    return {
      review: {
        id: raw.id,
        rating: ratingToStars(raw.rating),
        body: raw.body,
        hasSpoilers: raw.has_spoilers,
        createdAt: raw.created_at,
        gameSlug: gameSlugFor(raw),
      },
      author,
      likeCount: likeCountByReviewId.get(raw.id) ?? 0,
      viewerHasLiked: likedReviewIds.has(raw.id),
    };
  });
}
