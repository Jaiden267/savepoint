import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars } from "@/lib/rating";
import { avatarUrl } from "@/server/services/avatar";
import { cursorSchema, type Cursor } from "@/lib/validation/common";
import type { Json } from "@/types/database";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const DEFAULT_PAGE_SIZE = 20;

export interface FeedActor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface FeedGame {
  slug: string;
  name: string;
  coverImageId: string | null;
}

export type FeedItem =
  | {
      id: string;
      eventType: "review_published";
      createdAt: string;
      actor: FeedActor;
      game: FeedGame;
      reviewId: string;
      rating: number;
      hasSpoilers: boolean;
      bodySnippet: string;
    }
  | {
      id: string;
      eventType: "game_rated";
      createdAt: string;
      actor: FeedActor;
      game: FeedGame;
      rating: number;
    }
  | {
      id: string;
      eventType: "game_completed";
      createdAt: string;
      actor: FeedActor;
      game: FeedGame;
    }
  | {
      id: string;
      eventType: "diary_entry_logged";
      createdAt: string;
      actor: FeedActor;
      game: FeedGame;
      playedOn: string;
      isReplay: boolean;
    }
  | {
      id: string;
      eventType: "list_created";
      createdAt: string;
      actor: FeedActor;
      listId: string;
      title: string;
      isRanked: boolean;
    }
  | {
      id: string;
      eventType: "follow_created";
      createdAt: string;
      actor: FeedActor;
      followedUser: FeedActor;
    };

export interface HomeFeedPage {
  items: FeedItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

const BODY_SNIPPET_LENGTH = 240;

function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.created_at, i: row.id })).toString(
    "base64url",
  );
}

/** Malformed/tampered cursor decodes to null, never throws — callers fall back to page 1. */
function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const json: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf-8"),
    );
    const parsed = cursorSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function metaString(metadata: Json, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, Json | undefined>)[key];
  return typeof value === "string" ? value : null;
}

function metaNumber(metadata: Json, key: string): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, Json | undefined>)[key];
  return typeof value === "number" ? value : null;
}

function metaBoolean(metadata: Json, key: string): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, Json | undefined>)[key];
  return value === true;
}

interface RawActivityEvent {
  id: string;
  actor_id: string;
  event_type: string;
  object_type: string;
  object_id: string;
  game_id: string | null;
  metadata: Json;
  created_at: string;
}

/**
 * Home activity feed for the users `viewerId` follows. Keyset-paginated on
 * `(created_at desc, id desc)` — a live-inserting feed under offset
 * pagination would skip/duplicate rows across pages, so this deliberately
 * deviates from the offset convention used elsewhere in this codebase
 * (library/diary/discover).
 *
 * Re-checks *current* visibility of every event's referenced object through
 * this same RLS-scoped session client before rendering — an
 * `activity_events` row being safe to log at INSERT time (the
 * `fn_log_list_activity()` trigger already skips private lists) does not
 * mean it's still safe to surface later: a list can go private/unlisted
 * after creation, or its source row can be deleted. Suppressed events are
 * simply dropped from the rendered page; the *next* cursor is still derived
 * from the last *raw* fetched row (not the last surviving one), so
 * suppression can make a page shorter than `pageSize` without ever
 * skipping or duplicating an event across pages.
 */
export async function getHomeFeed({
  viewerId,
  cursor,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  viewerId: string;
  cursor?: string | null;
  pageSize?: number;
}): Promise<HomeFeedPage> {
  const supabase = await createClient();

  const { data: followRows } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", viewerId);

  const followingIds = (followRows ?? []).map((row) => row.following_id);
  if (followingIds.length === 0) {
    return { items: [], hasMore: false, nextCursor: null };
  }

  let query = supabase
    .from("activity_events")
    .select(
      "id, actor_id, event_type, object_type, object_id, game_id, metadata, created_at",
    )
    .in("actor_id", followingIds)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1); // fetch one extra row to know if there's a next page

  const decoded = decodeCursor(cursor);
  if (decoded) {
    query = query.or(
      `created_at.lt.${decoded.t},and(created_at.eq.${decoded.t},id.lt.${decoded.i})`,
    );
  }

  const { data, error } = await query;
  if (error || !data) return { items: [], hasMore: false, nextCursor: null };

  const rawRows = data as RawActivityEvent[];
  const hasMore = rawRows.length > pageSize;
  const page = rawRows.slice(0, pageSize);
  const nextCursor =
    hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null;

  const items = await hydrateFeedPage(supabase, page);
  return { items, hasMore, nextCursor };
}

async function hydrateFeedPage(
  supabase: SupabaseClient,
  page: RawActivityEvent[],
): Promise<FeedItem[]> {
  if (page.length === 0) return [];

  const reviewIds = page
    .filter((row) => row.object_type === "review")
    .map((row) => row.object_id);
  const userGameIds = page
    .filter((row) => row.object_type === "user_game")
    .map((row) => row.object_id);
  const diaryIds = page
    .filter((row) => row.object_type === "diary_entry")
    .map((row) => row.object_id);
  const listIds = page
    .filter((row) => row.object_type === "list")
    .map((row) => row.object_id);
  const followIds = page
    .filter((row) => row.object_type === "follow")
    .map((row) => row.object_id);

  const [
    reviewsResult,
    userGamesResult,
    diaryResult,
    listsResult,
    followsResult,
  ] = await Promise.all([
    reviewIds.length > 0
      ? supabase.from("reviews").select("id, body").in("id", reviewIds)
      : Promise.resolve({ data: [] }),
    userGameIds.length > 0
      ? supabase.from("user_games").select("id").in("id", userGameIds)
      : Promise.resolve({ data: [] }),
    diaryIds.length > 0
      ? supabase.from("diary_entries").select("id").in("id", diaryIds)
      : Promise.resolve({ data: [] }),
    listIds.length > 0
      ? supabase.from("lists").select("id, visibility").in("id", listIds)
      : Promise.resolve({ data: [] }),
    followIds.length > 0
      ? supabase.from("follows").select("id").in("id", followIds)
      : Promise.resolve({ data: [] }),
  ]);

  const reviewBodyById = new Map(
    (reviewsResult.data ?? []).map((row) => [row.id, row.body]),
  );
  const existingUserGameIds = new Set(
    (userGamesResult.data ?? []).map((row) => row.id),
  );
  const existingDiaryIds = new Set(
    (diaryResult.data ?? []).map((row) => row.id),
  );
  // Suppressed not just when the list is gone, but when it's since gone
  // private OR unlisted — unlisted stays reachable by direct URL but must
  // never surface through the feed, same rule as discovery.
  const publicListIds = new Set(
    (listsResult.data ?? [])
      .filter((row) => row.visibility === "public")
      .map((row) => row.id),
  );
  const existingFollowIds = new Set(
    (followsResult.data ?? []).map((row) => row.id),
  );

  const surviving = page.filter((row) => {
    switch (row.object_type) {
      case "review":
        return reviewBodyById.has(row.object_id);
      case "user_game":
        return existingUserGameIds.has(row.object_id);
      case "diary_entry":
        return existingDiaryIds.has(row.object_id);
      case "list":
        return publicListIds.has(row.object_id);
      case "follow":
        return existingFollowIds.has(row.object_id);
      default:
        return false;
    }
  });

  if (surviving.length === 0) return [];

  const gameIds = Array.from(
    new Set(
      surviving
        .map((row) => row.game_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const followedUserIds = surviving
    .filter((row) => row.object_type === "follow")
    .map((row) => metaString(row.metadata, "following_id"))
    .filter((id): id is string => Boolean(id));
  const profileIds = Array.from(
    new Set([...surviving.map((row) => row.actor_id), ...followedUserIds]),
  );

  const [gamesResult, profilesResult] = await Promise.all([
    gameIds.length > 0
      ? supabase
          .from("games")
          .select("id, slug, name, cover_image_id")
          .in("id", gameIds)
      : Promise.resolve({ data: [] }),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, username, display_name, avatar_path")
          .in("id", profileIds)
      : Promise.resolve({ data: [] }),
  ]);

  const gamesById = new Map((gamesResult.data ?? []).map((g) => [g.id, g]));
  const profilesById = new Map(
    (profilesResult.data ?? []).map((p) => [p.id, p]),
  );

  function actorFor(id: string): FeedActor {
    const profile = profilesById.get(id);
    return {
      id,
      username: profile?.username ?? "unknown",
      displayName: profile?.display_name ?? null,
      avatarUrl: avatarUrl(supabase, profile?.avatar_path ?? null),
    };
  }

  function gameFor(id: string | null): FeedGame | null {
    if (!id) return null;
    const game = gamesById.get(id);
    if (!game) return null;
    return {
      slug: game.slug,
      name: game.name,
      coverImageId: game.cover_image_id,
    };
  }

  const items: FeedItem[] = [];
  for (const row of surviving) {
    const actor = actorFor(row.actor_id);
    const game = gameFor(row.game_id);

    if (row.event_type === "review_published" && game) {
      const rawRating = metaNumber(row.metadata, "rating");
      const body = reviewBodyById.get(row.object_id) ?? "";
      items.push({
        id: row.id,
        eventType: "review_published",
        createdAt: row.created_at,
        actor,
        game,
        reviewId: row.object_id,
        rating: rawRating != null ? ratingToStars(rawRating) : 0,
        hasSpoilers: metaBoolean(row.metadata, "has_spoilers"),
        bodySnippet:
          body.length > BODY_SNIPPET_LENGTH
            ? `${body.slice(0, BODY_SNIPPET_LENGTH)}…`
            : body,
      });
    } else if (row.event_type === "game_rated" && game) {
      const rawRating = metaNumber(row.metadata, "rating");
      if (rawRating == null) continue;
      items.push({
        id: row.id,
        eventType: "game_rated",
        createdAt: row.created_at,
        actor,
        game,
        rating: ratingToStars(rawRating),
      });
    } else if (row.event_type === "game_completed" && game) {
      items.push({
        id: row.id,
        eventType: "game_completed",
        createdAt: row.created_at,
        actor,
        game,
      });
    } else if (row.event_type === "diary_entry_logged" && game) {
      const playedOn = metaString(row.metadata, "played_on");
      if (!playedOn) continue;
      items.push({
        id: row.id,
        eventType: "diary_entry_logged",
        createdAt: row.created_at,
        actor,
        game,
        playedOn,
        isReplay: metaBoolean(row.metadata, "is_replay"),
      });
    } else if (row.event_type === "list_created") {
      const title = metaString(row.metadata, "title");
      if (!title) continue;
      items.push({
        id: row.id,
        eventType: "list_created",
        createdAt: row.created_at,
        actor,
        listId: row.object_id,
        title,
        isRanked: metaBoolean(row.metadata, "is_ranked"),
      });
    } else if (row.event_type === "follow_created") {
      const followingId = metaString(row.metadata, "following_id");
      if (!followingId) continue;
      items.push({
        id: row.id,
        eventType: "follow_created",
        createdAt: row.created_at,
        actor,
        followedUser: actorFor(followingId),
      });
    }
    // Any other combination (e.g. a rating/completion/diary event whose
    // game_id was set null by an ON DELETE SET NULL) is silently dropped —
    // there is nothing safe/meaningful left to render for it.
  }

  return items;
}
