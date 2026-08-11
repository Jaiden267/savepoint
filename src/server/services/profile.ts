import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars } from "@/lib/rating";

const RECENTLY_PLAYED_LIMIT = 8;
const FAVOURITES_LIMIT = 8;

export interface ProfileRecord {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarPath: string | null;
  createdAt: string;
}

/** Looked up once by the `/users/[username]` segment's layout.tsx (for `notFound()` + the shared header) and again, independently, by each tab page — a cheap, indexed single-row lookup, not worth adding request-memoization plumbing for. */
export async function getProfileByUsername(
  username: string,
): Promise<ProfileRecord | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_path, created_at")
    .eq("username", username)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    username: data.username,
    displayName: data.display_name,
    bio: data.bio,
    avatarPath: data.avatar_path,
    createdAt: data.created_at,
  };
}

export interface ProfileStatsRecord {
  gamesCompleted: number;
  reviewCount: number;
  listCount: number;
  followerCount: number;
  followingCount: number;
}

/** Wraps the `profile_stats` view (security_invoker — a non-owner viewer correctly sees list_count excluding that profile's private lists, automatically). */
export async function getProfileStats(
  userId: string,
): Promise<ProfileStatsRecord> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_stats")
    .select(
      "games_completed, review_count, list_count, follower_count, following_count",
    )
    .eq("user_id", userId)
    .maybeSingle();

  return {
    gamesCompleted: data?.games_completed ?? 0,
    reviewCount: data?.review_count ?? 0,
    listCount: data?.list_count ?? 0,
    followerCount: data?.follower_count ?? 0,
    followingCount: data?.following_count ?? 0,
  };
}

export interface ProfileGameSummary {
  gameId: string;
  gameSlug: string;
  gameName: string;
  coverImageId: string | null;
}

export interface RecentlyPlayedEntry extends ProfileGameSummary {
  playedOn: string;
}

export interface FavouriteGameEntry extends ProfileGameSummary {
  rating: number;
}

/**
 * Distinct games from `userId`'s diary, most recently played first. Diary
 * entries are public per RLS (see docs/SOCIAL.md), so this renders fully
 * for any viewer including signed out. Over-fetches raw rows and dedupes by
 * game in application code (repeat playthroughs are common — a straight
 * `limit()` on raw rows could return the same game several times) rather
 * than a `distinct on` query, since PostgREST's REST surface doesn't expose
 * `DISTINCT ON`.
 */
export async function getRecentlyPlayed(
  userId: string,
): Promise<RecentlyPlayedEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("diary_entries")
    .select("played_on, games!inner(id, slug, name, cover_image_id)")
    .eq("user_id", userId)
    .order("played_on", { ascending: false })
    .limit(RECENTLY_PLAYED_LIMIT * 4);

  const seen = new Set<string>();
  const entries: RecentlyPlayedEntry[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.games.id)) continue;
    seen.add(row.games.id);
    entries.push({
      gameId: row.games.id,
      gameSlug: row.games.slug,
      gameName: row.games.name,
      coverImageId: row.games.cover_image_id,
      playedOn: row.played_on,
    });
    if (entries.length >= RECENTLY_PLAYED_LIMIT) break;
  }
  return entries;
}

/** `userId`'s highest-rated library games — user_games is public per RLS. */
export async function getFavouriteGames(
  userId: string,
): Promise<FavouriteGameEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_games")
    .select("rating, games!inner(id, slug, name, cover_image_id)")
    .eq("user_id", userId)
    .not("rating", "is", null)
    .order("rating", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(FAVOURITES_LIMIT);

  return (data ?? [])
    .filter(
      (row): row is typeof row & { rating: number } => row.rating !== null,
    )
    .map((row) => ({
      gameId: row.games.id,
      gameSlug: row.games.slug,
      gameName: row.games.name,
      coverImageId: row.games.cover_image_id,
      rating: ratingToStars(row.rating),
    }));
}

export interface RatingDistributionBucket {
  /** Raw 1-10 database rating — convert with ratingToStars() at the display boundary, same as everywhere else in this codebase. */
  dbRating: number;
  gameCount: number;
}

/**
 * Bucketed rating histogram for `userId`'s own library, via the
 * `user_rating_distribution` view (migration 19) — bounded to at most 10
 * rows regardless of library size, so unlike a per-GAME histogram
 * (deliberately not built in Prompt 4), this can never hit PostgREST's
 * default row cap.
 */
export async function getRatingDistribution(
  userId: string,
): Promise<RatingDistributionBucket[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_rating_distribution")
    .select("rating, game_count")
    .eq("user_id", userId)
    .order("rating", { ascending: true });

  return (data ?? [])
    .filter(
      (row): row is { rating: number; game_count: number } =>
        row.rating != null && row.game_count != null,
    )
    .map((row) => ({ dbRating: row.rating, gameCount: row.game_count }));
}
