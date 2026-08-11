import "server-only";
import { createClient } from "@/lib/supabase/server";
import { avatarUrl } from "@/server/services/avatar";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const DEFAULT_PAGE_SIZE = 24;

export interface FollowProfileSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface FollowListPage {
  profiles: FollowProfileSummary[];
  hasMore: boolean;
}

/**
 * `follows.follower_id`/`following_id` FK to `auth.users`, not
 * `public.profiles` — there is no FK PostgREST can embed `profiles` through
 * here, so this batches a separate lookup and re-maps by id, same as every
 * other author-hydration path in this codebase (game-social.ts, reviews.ts)
 * for the identical reason.
 */
async function hydrateProfiles(
  supabase: SupabaseClient,
  orderedIds: string[],
): Promise<FollowProfileSummary[]> {
  if (orderedIds.length === 0) return [];

  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_path")
    .in("id", orderedIds);

  const byId = new Map((data ?? []).map((profile) => [profile.id, profile]));

  return orderedIds.map((id) => {
    const profile = byId.get(id);
    return {
      id,
      username: profile?.username ?? "unknown",
      displayName: profile?.display_name ?? null,
      avatarUrl: avatarUrl(supabase, profile?.avatar_path ?? null),
    };
  });
}

/** Users who follow `userId`, paginated newest-first. */
export async function getFollowers({
  userId,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  userId: string;
  page: number;
  pageSize?: number;
}): Promise<FollowListPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra row to know if there's a next page

  const { data, error } = await supabase
    .from("follows")
    .select("follower_id, created_at")
    .eq("following_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !data) return { profiles: [], hasMore: false };

  const hasMore = data.length > pageSize;
  const rows = data.slice(0, pageSize);
  const profiles = await hydrateProfiles(
    supabase,
    rows.map((row) => row.follower_id),
  );
  return { profiles, hasMore };
}

/** Users `userId` follows, paginated newest-first. */
export async function getFollowing({
  userId,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  userId: string;
  page: number;
  pageSize?: number;
}): Promise<FollowListPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  const { data, error } = await supabase
    .from("follows")
    .select("following_id, created_at")
    .eq("follower_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !data) return { profiles: [], hasMore: false };

  const hasMore = data.length > pageSize;
  const rows = data.slice(0, pageSize);
  const profiles = await hydrateProfiles(
    supabase,
    rows.map((row) => row.following_id),
  );
  return { profiles, hasMore };
}

/** Whether `viewerId` currently follows `targetId`. Null viewer (signed out) is never following anyone. */
export async function isFollowing(
  viewerId: string | null,
  targetId: string,
): Promise<boolean> {
  if (!viewerId || viewerId === targetId) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("follows")
    .select("id")
    .eq("follower_id", viewerId)
    .eq("following_id", targetId)
    .maybeSingle();
  return Boolean(data);
}
