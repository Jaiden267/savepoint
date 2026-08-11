import "server-only";
import { createClient } from "@/lib/supabase/server";
import { avatarUrl } from "@/server/services/avatar";
import type { ListVisibility } from "@/lib/validation/lists";

const DEFAULT_PAGE_SIZE = 24;

export interface ListItemDetail {
  id: string;
  gameId: string;
  gameSlug: string;
  gameName: string;
  coverImageId: string | null;
  releaseYear: number | null;
  position: number;
  note: string | null;
}

export interface ListDetail {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  isRanked: boolean;
  visibility: ListVisibility;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  items: ListItemDetail[];
}

/**
 * `viewerId` is never used to filter — RLS on the request-scoped session
 * client (`src/lib/supabase/server.ts`) already does that automatically,
 * based on the real auth cookie, regardless of what's passed here. It's
 * only used to compute `isOwner` for the view model (so the page doesn't
 * need a second `auth.getUser()` call to decide whether to show edit
 * controls). A private list the viewer doesn't own simply comes back as no
 * row at all — RLS's job, not this function's.
 */
export async function getListDetail(
  listId: string,
  viewerId: string | null,
): Promise<ListDetail | null> {
  const supabase = await createClient();

  const { data: listRow } = await supabase
    .from("lists")
    .select(
      "id, user_id, title, description, is_ranked, visibility, created_at, updated_at",
    )
    .eq("id", listId)
    .maybeSingle();

  if (!listRow) return null;

  const { data: itemRows } = await supabase
    .from("list_items")
    .select(
      "id, game_id, position, note, games!inner(slug, name, cover_image_id, release_date)",
    )
    .eq("list_id", listId)
    .order("position", { ascending: true });

  const items: ListItemDetail[] = (itemRows ?? []).map((row) => ({
    id: row.id,
    gameId: row.game_id,
    gameSlug: row.games.slug,
    gameName: row.games.name,
    coverImageId: row.games.cover_image_id,
    releaseYear: row.games.release_date
      ? new Date(row.games.release_date).getUTCFullYear()
      : null,
    position: row.position,
    note: row.note,
  }));

  return {
    id: listRow.id,
    userId: listRow.user_id,
    title: listRow.title,
    description: listRow.description,
    isRanked: listRow.is_ranked,
    visibility: listRow.visibility as ListVisibility,
    createdAt: listRow.created_at,
    updatedAt: listRow.updated_at,
    isOwner: viewerId != null && viewerId === listRow.user_id,
    items,
  };
}

export interface ListSummary {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  isRanked: boolean;
  visibility: ListVisibility;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListSummaryPage {
  lists: ListSummary[];
  hasMore: boolean;
}

function toListSummary(row: {
  id: string | null;
  user_id: string | null;
  title: string | null;
  description: string | null;
  is_ranked: boolean | null;
  visibility: string | null;
  item_count: number | null;
  created_at: string | null;
  updated_at: string | null;
}): ListSummary {
  return {
    id: row.id!,
    userId: row.user_id!,
    title: row.title!,
    description: row.description,
    isRanked: row.is_ranked ?? false,
    visibility: (row.visibility ?? "private") as ListVisibility,
    itemCount: row.item_count ?? 0,
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
  };
}

/**
 * A profile's own Lists tab. Queries `list_public_summary` (for the free
 * `item_count`) rather than `lists` directly — still fully RLS-scoped
 * (security_invoker), since the view can never surface a row the caller
 * couldn't already read from `lists` itself.
 *
 * RLS alone would still let a non-owner viewer read `userId`'s *unlisted*
 * lists here (that's what "unlisted" means at the RLS layer — reachable by
 * anyone with the id/link) — but a profile's Lists tab is a browsable
 * index, not a direct link, so unlisted lists are explicitly excluded for
 * every viewer except the owner. This mirrors the same "unlisted excluded
 * from discovery" rule applied to `getPopularPublicLists` below.
 */
export async function getProfileLists({
  userId,
  viewerId,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  userId: string;
  viewerId: string | null;
  page: number;
  pageSize?: number;
}): Promise<ListSummaryPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra row to know if there's a next page

  let query = supabase
    .from("list_public_summary")
    .select(
      "id, user_id, title, description, is_ranked, visibility, item_count, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const isOwner = viewerId != null && viewerId === userId;
  if (!isOwner) {
    query = query.eq("visibility", "public");
  }

  const { data, error } = await query.range(from, to);
  if (error || !data) return { lists: [], hasMore: false };

  const hasMore = data.length > pageSize;
  return { lists: data.slice(0, pageSize).map(toListSummary), hasMore };
}

export interface ListSummaryWithAuthor extends ListSummary {
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

/**
 * Cross-user "popular public lists" for the discovery page. Explicitly
 * filters `visibility = 'public'` — `list_public_summary` is RLS-scoped so
 * it would never leak a *private* row, but "unlisted" is RLS-readable and
 * must still be excluded from a browse/discovery surface by application
 * logic (documented convention, see docs/DATABASE.md).
 */
export interface ListSummaryWithAuthorPage {
  lists: ListSummaryWithAuthor[];
  hasMore: boolean;
}

export async function getPopularPublicLists({
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  page: number;
  pageSize?: number;
}): Promise<ListSummaryWithAuthorPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  const { data, error } = await supabase
    .from("list_public_summary")
    .select(
      "id, user_id, title, description, is_ranked, visibility, item_count, created_at, updated_at",
    )
    .eq("visibility", "public")
    .order("item_count", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !data) return { lists: [], hasMore: false };

  const hasMore = data.length > pageSize;
  const rows = data.slice(0, pageSize);

  const authorIds = Array.from(
    new Set(
      rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: profiles } =
    authorIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_path")
          .in("id", authorIds)
      : { data: [] };
  const profilesById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );

  const lists: ListSummaryWithAuthor[] = rows.map((row) => {
    const summary = toListSummary(row);
    const profile = profilesById.get(summary.userId);
    return {
      ...summary,
      author: {
        username: profile?.username ?? "unknown",
        displayName: profile?.display_name ?? null,
        avatarUrl: avatarUrl(supabase, profile?.avatar_path ?? null),
      },
    };
  });

  return { lists, hasMore };
}
