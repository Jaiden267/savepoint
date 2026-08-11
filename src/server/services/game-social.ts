import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars, averageRatingToStars } from "@/lib/rating";
import { hydrateReviews } from "@/server/services/review-hydration";
import type {
  ReviewCardData,
  ReviewCardAuthor,
} from "@/components/reviews/review-card";
import type { LibraryStatus } from "@/lib/validation/library";
import type { Tables } from "@/types/database";

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

  const recentReviews = await hydrateReviews(
    supabase,
    rawReviews,
    () => gameSlug,
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
