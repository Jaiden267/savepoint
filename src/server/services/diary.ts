import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars } from "@/lib/rating";

const DEFAULT_PAGE_SIZE = 24;

export interface DiaryListEntry {
  id: string;
  gameId: string;
  gameSlug: string;
  gameName: string;
  coverImageId: string | null;
  playedOn: string;
  rating: number | null;
  isReplay: boolean;
  note: string | null;
}

export interface DiaryListPage {
  entries: DiaryListEntry[];
  hasMore: boolean;
}

/**
 * Paginated listing of one user's diary, newest play first. `userId` must
 * always be derived server-side (see /diary/page.tsx) — this function trusts
 * whatever id it's given, so the caller is the security boundary.
 */
export async function listUserDiaryEntries({
  userId,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  userId: string;
  page: number;
  pageSize?: number;
}): Promise<DiaryListPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra row to know if there's a next page

  const { data, error } = await supabase
    .from("diary_entries")
    .select(
      "id, game_id, played_on, rating, is_replay, note, games!inner(slug, name, cover_image_id)",
    )
    .eq("user_id", userId)
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !data) return { entries: [], hasMore: false };

  const hasMore = data.length > pageSize;
  const rows = data.slice(0, pageSize);

  const entries: DiaryListEntry[] = rows.map((row) => ({
    id: row.id,
    gameId: row.game_id,
    gameSlug: row.games.slug,
    gameName: row.games.name,
    coverImageId: row.games.cover_image_id,
    playedOn: row.played_on,
    rating: row.rating === null ? null : ratingToStars(row.rating),
    isReplay: row.is_replay,
    note: row.note,
  }));

  return { entries, hasMore };
}
