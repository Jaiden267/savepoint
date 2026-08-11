import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratingToStars } from "@/lib/rating";
import type { LibraryStatus } from "@/lib/validation/library";

const DEFAULT_PAGE_SIZE = 24;

export type LibrarySort = "updated" | "rating_desc" | "alpha";

export interface LibraryEntry {
  gameId: string;
  gameSlug: string;
  gameName: string;
  coverImageId: string | null;
  releaseYear: number | null;
  status: LibraryStatus;
  rating: number | null;
  updatedAt: string;
}

export interface LibraryListPage {
  entries: LibraryEntry[];
  hasMore: boolean;
}

/**
 * Paginated, filtered, sorted listing of one user's library. `userId` must
 * always be derived server-side (see /library/page.tsx) — this function
 * trusts whatever id it's given, so the caller is the security boundary.
 *
 * Uses a single embedded select (`user_games` -> `games`) rather than the
 * two-step fetchTaggedRefs pattern games/[slug]/page.tsx uses for
 * many-to-many joins: `user_games.game_id -> games.id` is a plain many-to-one
 * FK against the fully regenerated database.ts, the standard well-typed
 * embed case — and embedding is what makes the `alpha` sort (ordering by
 * games.name) possible without a second round trip.
 */
export async function listUserLibrary({
  userId,
  status,
  sort = "updated",
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  userId: string;
  status: LibraryStatus | null;
  sort?: LibrarySort;
  page: number;
  pageSize?: number;
}): Promise<LibraryListPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra row to know if there's a next page

  let query = supabase
    .from("user_games")
    .select(
      "game_id, status, rating, updated_at, games!inner(slug, name, cover_image_id, release_date)",
    )
    .eq("user_id", userId);

  if (status) {
    query = query.eq("status", status);
  }

  if (sort === "rating_desc") {
    query = query.order("rating", { ascending: false, nullsFirst: false });
  } else if (sort === "alpha") {
    query = query.order("name", { ascending: true, referencedTable: "games" });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query.range(from, to);

  if (error || !data) return { entries: [], hasMore: false };

  const hasMore = data.length > pageSize;
  const rows = data.slice(0, pageSize);

  const entries: LibraryEntry[] = rows.map((row) => ({
    gameId: row.game_id,
    gameSlug: row.games.slug,
    gameName: row.games.name,
    coverImageId: row.games.cover_image_id,
    releaseYear: row.games.release_date
      ? new Date(row.games.release_date).getUTCFullYear()
      : null,
    status: row.status as LibraryStatus,
    rating: row.rating === null ? null : ratingToStars(row.rating),
    updatedAt: row.updated_at,
  }));

  return { entries, hasMore };
}
