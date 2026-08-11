import "server-only";
import { createClient } from "@/lib/supabase/server";
import { avatarUrl } from "@/server/services/avatar";
import {
  hydrateReviews,
  type HydratedReview,
} from "@/server/services/review-hydration";

const DEFAULT_PAGE_SIZE = 24;

/** Escapes ILIKE wildcards so `%`/`_` behave as literal characters, not pattern wildcards (mirrors game-catalogue.ts's escapeIlikePattern). */
function escapeIlikePattern(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

/**
 * Quotes a value for safe interpolation into a PostgREST `.or()`/`.and()`
 * filter string — those strings use bare commas and parentheses as
 * structural delimiters, so an unquoted user-supplied search query
 * containing either would corrupt the filter rather than just fail to
 * match. Per PostgREST's own syntax, wrapping the value in double quotes
 * (with any literal `"` escaped) makes it opaque to the delimiter parser.
 */
function quoteForOrFilter(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export interface ProfileSearchResult {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

export interface ProfileSearchPage {
  profiles: ProfileSearchResult[];
  hasMore: boolean;
}

/** User search by username/display name — public profile fields only, exactly what profiles' own public RLS already exposes to anyone. */
export async function searchProfiles({
  query,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  query: string;
  page: number;
  pageSize?: number;
}): Promise<ProfileSearchPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra row to know if there's a next page

  const pattern = quoteForOrFilter(`%${escapeIlikePattern(query)}%`);

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_path, bio")
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .order("username", { ascending: true })
    .range(from, to);

  if (error || !data) return { profiles: [], hasMore: false };

  const hasMore = data.length > pageSize;
  const rows = data.slice(0, pageSize);
  return {
    profiles: rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: avatarUrl(supabase, row.avatar_path),
      bio: row.bio,
    })),
    hasMore,
  };
}

export interface RecentReviewsPage {
  reviews: HydratedReview[];
  hasMore: boolean;
}

/** Recent public reviews across every game — reviews are always public per RLS, no visibility filter needed. */
export async function getRecentPublicReviews({
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  viewerId = null,
}: {
  page: number;
  pageSize?: number;
  viewerId?: string | null;
}): Promise<RecentReviewsPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  const { data, error } = await supabase
    .from("reviews")
    .select("id, user_id, game_id, rating, body, has_spoilers, created_at")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !data) return { reviews: [], hasMore: false };

  const hasMore = data.length > pageSize;
  const rows = data.slice(0, pageSize);

  const gameIds = Array.from(new Set(rows.map((row) => row.game_id)));
  const { data: games } =
    gameIds.length > 0
      ? await supabase.from("games").select("id, slug").in("id", gameIds)
      : { data: [] };
  const slugByGameId = new Map((games ?? []).map((g) => [g.id, g.slug]));
  // Keyed by review id (not game_id) because hydrateReviews' RawReviewRow
  // type doesn't carry game_id — only the fields it actually needs.
  const slugByReviewId = new Map(
    rows.map((row) => [row.id, slugByGameId.get(row.game_id) ?? ""]),
  );

  const reviews = await hydrateReviews(
    supabase,
    rows,
    (row) => slugByReviewId.get(row.id) ?? "",
    viewerId,
  );

  return { reviews, hasMore };
}
