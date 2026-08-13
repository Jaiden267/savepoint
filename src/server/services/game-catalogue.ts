import "server-only";
import { createClient } from "@/lib/supabase/server";
import { searchIgdbGames } from "@/lib/igdb/search";
import { rankSearchResults } from "@/lib/igdb/ranking";
import { checkRateLimit } from "@/lib/rate-limit";
import type { GameSearchResult } from "@/lib/igdb/types";
import type { Tables } from "@/types/database";

const LOCAL_RESULT_THRESHOLD = 5;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 24;

type GameRow = Tables<"games">;

/** Escapes ILIKE wildcards in user-supplied text so `%`/`_` behave as literal characters, not pattern wildcards. */
function escapeIlikePattern(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

export function toSearchResult(
  row: Pick<
    GameRow,
    | "igdb_id"
    | "slug"
    | "name"
    | "cover_image_id"
    | "release_date"
    | "igdb_game_type"
    | "version_parent_igdb_id"
  >,
): GameSearchResult {
  return {
    source: "local",
    igdbId: row.igdb_id,
    slug: row.slug,
    name: row.name,
    coverImageId: row.cover_image_id,
    releaseYear: row.release_date
      ? new Date(row.release_date).getUTCFullYear()
      : null,
    gameType: row.igdb_game_type,
    versionParentIgdbId: row.version_parent_igdb_id,
  };
}

/**
 * Local, trigram-backed name search (reuses `games_name_trgm_idx`). Reads
 * only — `games` is public-read, so the request-scoped session client is
 * fine here, no admin client needed.
 */
export async function searchLocalGames(
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<GameSearchResult[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("games")
    .select(
      "igdb_id, slug, name, cover_image_id, release_date, igdb_game_type, version_parent_igdb_id",
    )
    .ilike("name", `%${escapeIlikePattern(query)}%`)
    .limit(limit);

  if (error || !data) return [];
  return data.map(toSearchResult);
}

/**
 * Local-first, IGDB-fallback search. Writes nothing — a game is only ever
 * imported when explicitly opened (see game-sync.ts), never as a side
 * effect of appearing in a results list. Local and IGDB results are deduped
 * by `igdbId` (the local representation is kept, since it carries the real
 * internal slug needed for linking, but this only decides which
 * representation to keep — not which ranks higher). The full deduped set is
 * then ranked together as one list, so a weak local match can never
 * outrank a strong IGDB match, or vice versa.
 */
export async function searchGames(
  query: string,
  opts?: { limit?: number },
): Promise<GameSearchResult[]> {
  const limit = opts?.limit ?? DEFAULT_SEARCH_LIMIT;
  const local = await searchLocalGames(query, limit);

  let igdbResults: GameSearchResult[] = [];
  if (local.length < LOCAL_RESULT_THRESHOLD) {
    try {
      igdbResults = await searchIgdbGames(query, { limit });
    } catch {
      // IGDB unreachable/erroring shouldn't break local search results —
      // degrade to local-only rather than failing the whole search.
      igdbResults = [];
    }
  }

  const byIgdbId = new Map<number, GameSearchResult>();
  for (const result of local) byIgdbId.set(result.igdbId, result);
  for (const result of igdbResults) {
    if (!byIgdbId.has(result.igdbId)) byIgdbId.set(result.igdbId, result);
  }

  return rankSearchResults(query, Array.from(byIgdbId.values())).slice(
    0,
    limit,
  );
}

const DISCOVER_RATE_LIMIT = { limit: 15, windowSeconds: 60 };

/**
 * Rate-limits /discover page loads and "Shuffle games" clicks —
 * separately keyed (`discover:${clientId}`) from
 * checkImportRateLimit/checkCatalogueImportRateLimit's `game-import`/
 * `catalogue-import` buckets, so repeated shuffling can never share or
 * weaken the on-demand import budget. 15/60s is generous for normal
 * browsing while bounding scripted abuse of the ledger/Pinecone reads a
 * full selection costs — see src/server/services/discover-catalogue.ts.
 */
export function checkDiscoverRateLimit(clientId: string) {
  return checkRateLimit(`discover:${clientId}`, DISCOVER_RATE_LIMIT);
}

export interface DiscoverPage {
  games: GameRow[];
  hasMore: boolean;
}

/**
 * Pure local, paginated listing of already-cached games — no IGDB, no
 * catalogue ledger, no rate-limit cost. No longer /discover's primary
 * data source (see discover-catalogue.ts's listDiscoverCatalogue, which
 * samples the full synced Balanced catalogue instead); this is now used
 * only as discover-results.tsx's degraded-mode fallback when the ledger
 * or Pinecone is genuinely unavailable.
 */
export async function listDiscoverGames({
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  page: number;
  pageSize?: number;
}): Promise<DiscoverPage> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra row to know if there's a next page

  const { data, error } = await supabase
    .from("games")
    .select("*")
    .order("igdb_rating_count", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !data) return { games: [], hasMore: false };

  const hasMore = data.length > pageSize;
  return { games: data.slice(0, pageSize), hasMore };
}
