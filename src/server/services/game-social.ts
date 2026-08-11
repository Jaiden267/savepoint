import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars, averageRatingToStars } from "@/lib/rating";
import type {
  ReviewCardData,
  ReviewCardAuthor,
} from "@/components/reviews/review-card";
import type { LibraryStatus } from "@/lib/validation/library";
import type { Tables } from "@/types/database";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface DiaryEntrySummary {
  id: string;
  playedOn: string;
  rating: number | null;
  isReplay: boolean;
  note: string | null;
}

export interface OwnReviewSummary {
  id: string;
  rating: number;
  body: string;
  hasSpoilers: boolean;
}

export interface RecentReview {
  review: ReviewCardData;
  author: ReviewCardAuthor;
  likeCount: number;
  viewerHasLiked: boolean;
}

export interface GameSocialData {
  userGame: { status: LibraryStatus; rating: number | null } | null;
  recentDiaryEntries: DiaryEntrySummary[];
  ownReview: OwnReviewSummary | null;
  ratingStats: { averageStars: number | null; ratingCount: number };
  recentReviews: RecentReview[];
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
 * Everything the game page's action panel + ratings + recent-reviews
 * sections need, batched into two tiers (never one query per review row —
 * see game-catalogue.ts for the established N+1-avoidance convention this
 * mirrors). Tier 1 runs once viewer/game ids are known; Tier 2 only for the
 * up-to-5 visible recent reviews' authors/like data.
 *
 * Deliberately does NOT fetch raw user_games rows to build a histogram —
 * PostgREST's default row cap could silently under-count a popular game.
 * Only game_rating_stats' small aggregated row is read (see the
 * rating-semantics invariant in docs/SOCIAL.md).
 */
export async function getGameSocialData(
  gameId: string,
  gameSlug: string,
  viewerId: string | null,
): Promise<GameSocialData> {
  const supabase = await createClient();

  const userGamePromise = viewerId
    ? supabase
        .from("user_games")
        .select("status, rating")
        .eq("user_id", viewerId)
        .eq("game_id", gameId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const diaryPromise = viewerId
    ? supabase
        .from("diary_entries")
        .select("id, played_on, rating, is_replay, note")
        .eq("user_id", viewerId)
        .eq("game_id", gameId)
        .order("played_on", { ascending: false })
        .limit(3)
    : Promise.resolve({ data: [] });

  const ownReviewPromise = viewerId
    ? supabase
        .from("reviews")
        .select("id, rating, body, has_spoilers")
        .eq("user_id", viewerId)
        .eq("game_id", gameId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const ratingStatsPromise = supabase
    .from("game_rating_stats")
    .select("average_rating, rating_count")
    .eq("game_id", gameId)
    .maybeSingle();

  let recentReviewsQuery = supabase
    .from("reviews")
    .select("id, user_id, rating, body, has_spoilers, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (viewerId) {
    recentReviewsQuery = recentReviewsQuery.neq("user_id", viewerId);
  }

  const [
    userGameResult,
    diaryResult,
    ownReviewResult,
    statsResult,
    reviewsResult,
  ] = await Promise.all([
    userGamePromise,
    diaryPromise,
    ownReviewPromise,
    ratingStatsPromise,
    recentReviewsQuery,
  ]);

  const userGame = userGameResult.data
    ? {
        status: userGameResult.data.status as LibraryStatus,
        rating:
          userGameResult.data.rating === null
            ? null
            : ratingToStars(userGameResult.data.rating),
      }
    : null;

  const recentDiaryEntries: DiaryEntrySummary[] = (diaryResult.data ?? []).map(
    (entry) => ({
      id: entry.id,
      playedOn: entry.played_on,
      rating: entry.rating === null ? null : ratingToStars(entry.rating),
      isReplay: entry.is_replay,
      note: entry.note,
    }),
  );

  const ownReview: OwnReviewSummary | null = ownReviewResult.data
    ? {
        id: ownReviewResult.data.id,
        rating: ratingToStars(ownReviewResult.data.rating),
        body: ownReviewResult.data.body,
        hasSpoilers: ownReviewResult.data.has_spoilers,
      }
    : null;

  const ratingStats = {
    averageStars:
      statsResult.data?.average_rating != null
        ? averageRatingToStars(statsResult.data.average_rating)
        : null,
    ratingCount: statsResult.data?.rating_count ?? 0,
  };

  const rawReviews: Pick<
    Tables<"reviews">,
    "id" | "user_id" | "rating" | "body" | "has_spoilers" | "created_at"
  >[] = reviewsResult.data ?? [];

  const recentReviews = await hydrateRecentReviews(
    supabase,
    rawReviews,
    gameSlug,
    viewerId,
  );

  return {
    userGame,
    recentDiaryEntries,
    ownReview,
    ratingStats,
    recentReviews,
  };
}

async function hydrateRecentReviews(
  supabase: SupabaseClient,
  rawReviews: Pick<
    Tables<"reviews">,
    "id" | "user_id" | "rating" | "body" | "has_spoilers" | "created_at"
  >[],
  gameSlug: string,
  viewerId: string | null,
): Promise<RecentReview[]> {
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
        gameSlug,
      },
      author,
      likeCount: likeCountByReviewId.get(raw.id) ?? 0,
      viewerHasLiked: likedReviewIds.has(raw.id),
    };
  });
}
