import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchIgdbGameByIgdbId, fetchIgdbGameBySlug } from "@/lib/igdb/detail";
import { checkRateLimit } from "@/lib/rate-limit";
import type { IgdbGameDetail } from "@/lib/igdb/types";
import type { Tables } from "@/types/database";

type GameRow = Tables<"games">;

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const IMPORT_RATE_LIMIT = { limit: 8, windowSeconds: 60 };

/** Thrown when a client has exhausted its per-client import rate limit and there's no cached row to fall back to. The page catches this and renders a calm message — never a raw error dump. */
export class GameImportRateLimitedError extends Error {
  constructor() {
    super("Too many game imports from this client. Please try again shortly.");
    this.name = "GameImportRateLimitedError";
  }
}

function isStale(igdbSyncedAt: string | null): boolean {
  if (!igdbSyncedAt) return true;
  return Date.now() - new Date(igdbSyncedAt).getTime() > REFRESH_TTL_MS;
}

/** The on-demand-import abuse-boundary rate limit, shared by getOrImportGameBySlug (below) and importCatalogueGameAction (src/server/actions/games.ts) — same shape, separately-keyed buckets so the two paths' budgets can't cross-exhaust each other. */
export function checkImportRateLimit(clientId: string) {
  return checkRateLimit(`game-import:${clientId}`, IMPORT_RATE_LIMIT);
}

/** Same limit shape as checkImportRateLimit, keyed separately for the catalogue-only import Server Action — see docs/PINECONE.md's on-demand-import-boundary section for why this is a distinct code path rather than reusing /games/[slug]'s GET-triggered import. */
export function checkCatalogueImportRateLimit(clientId: string) {
  return checkRateLimit(`catalogue-import:${clientId}`, IMPORT_RATE_LIMIT);
}

/**
 * The single shared idempotent upsert every import path funnels through.
 * `games.igdb_id` is unique and upserted on conflict, preserving the same
 * internal `uuid id` across re-imports (everything else FKs to that uuid).
 * Reference-table rows upsert on their own IGDB-native id. Join-table rows
 * are replaced (delete-then-insert, scoped to this game) so a re-import
 * correctly reflects any reclassification since the last sync — cheap,
 * since there are only ever a handful of rows per game. A second import of
 * the same `igdb_id` can never create a second `games` row or duplicate
 * join rows: idempotency here is structural, not conventional.
 */
export async function upsertGameFromIgdbDetail(
  detail: IgdbGameDetail,
): Promise<GameRow> {
  const admin = createAdminClient();

  if (detail.genres.length > 0) {
    const { error } = await admin
      .from("genres")
      .upsert(detail.genres, { onConflict: "id" });
    if (error) throw error;
  }
  if (detail.platforms.length > 0) {
    const { error } = await admin
      .from("platforms")
      .upsert(detail.platforms, { onConflict: "id" });
    if (error) throw error;
  }
  if (detail.gameModes.length > 0) {
    const { error } = await admin
      .from("game_modes")
      .upsert(detail.gameModes, { onConflict: "id" });
    if (error) throw error;
  }
  if (detail.themes.length > 0) {
    const { error } = await admin
      .from("themes")
      .upsert(detail.themes, { onConflict: "id" });
    if (error) throw error;
  }

  const { data: game, error: gameError } = await admin
    .from("games")
    .upsert(detail.game, { onConflict: "igdb_id" })
    .select()
    .single();
  if (gameError || !game) {
    throw gameError ?? new Error("Game upsert returned no row.");
  }

  const { error: deleteGenresError } = await admin
    .from("game_genres")
    .delete()
    .eq("game_id", game.id);
  if (deleteGenresError) throw deleteGenresError;
  if (detail.genres.length > 0) {
    const { error } = await admin
      .from("game_genres")
      .insert(detail.genres.map((g) => ({ game_id: game.id, genre_id: g.id })));
    if (error) throw error;
  }

  const { error: deletePlatformsError } = await admin
    .from("game_platforms")
    .delete()
    .eq("game_id", game.id);
  if (deletePlatformsError) throw deletePlatformsError;
  if (detail.platforms.length > 0) {
    const { error } = await admin.from("game_platforms").insert(
      detail.platforms.map((p) => ({
        game_id: game.id,
        platform_id: p.id,
      })),
    );
    if (error) throw error;
  }

  const { error: deleteModesError } = await admin
    .from("game_game_modes")
    .delete()
    .eq("game_id", game.id);
  if (deleteModesError) throw deleteModesError;
  if (detail.gameModes.length > 0) {
    const { error } = await admin.from("game_game_modes").insert(
      detail.gameModes.map((m) => ({
        game_id: game.id,
        game_mode_id: m.id,
      })),
    );
    if (error) throw error;
  }

  const { error: deleteThemesError } = await admin
    .from("game_themes")
    .delete()
    .eq("game_id", game.id);
  if (deleteThemesError) throw deleteThemesError;
  if (detail.themes.length > 0) {
    const { error } = await admin
      .from("game_themes")
      .insert(detail.themes.map((t) => ({ game_id: game.id, theme_id: t.id })));
    if (error) throw error;
  }

  // Marks the game for Pinecone sync without requiring Pinecone to be
  // available yet — src/lib/pinecone/sync.ts drains "pending" rows on
  // demand; nothing here calls Pinecone. `last_attempted_at: null` resets
  // the sync lease marker so a freshly (re)imported game is immediately
  // claimable, rather than looking like it's still under an active lease
  // from a previous attempt. attempt_count, error and last_synced_at are
  // deliberately left untouched — preserved as historical record.
  const { error: vectorSyncError } = await admin
    .from("game_vector_sync")
    .upsert(
      { game_id: game.id, status: "pending", last_attempted_at: null },
      { onConflict: "game_id" },
    );
  if (vectorSyncError) throw vectorSyncError;

  return game;
}

/** Imports (or refreshes, if stale) a game by IGDB id. A fresh local row short-circuits with no IGDB call. */
export async function importGameByIgdbId(igdbId: number): Promise<GameRow> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("games")
    .select("*")
    .eq("igdb_id", igdbId)
    .maybeSingle();

  if (existing && !isStale(existing.igdb_synced_at)) {
    return existing;
  }

  const detail = await fetchIgdbGameByIgdbId(igdbId);
  if (!detail) {
    // IGDB briefly unavailable, or the game was removed upstream — serve
    // what's cached rather than erroring, if anything is cached.
    if (existing) return existing;
    throw new Error(`IGDB has no game with id ${igdbId}.`);
  }
  return upsertGameFromIgdbDetail(detail);
}

/** Imports a game by IGDB slug — one detail fetch, funneled into the same shared upsert as every other import path. */
async function importGameBySlug(slug: string): Promise<GameRow | null> {
  const detail = await fetchIgdbGameBySlug(slug);
  if (!detail) return null;
  return upsertGameFromIgdbDetail(detail);
}

/** Local-only lookup — no IGDB call, no rate-limit cost. This is what keeps a fresh cache hit on `/games/[slug]` inexpensive. */
export async function findCachedGameBySlug(
  slug: string,
): Promise<GameRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("games")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}

/**
 * The single explicit trigger point for importing a game from a public page
 * view (`/games/[slug]`) — this is where the abuse boundary lives:
 *
 *  1. A fresh cache hit costs nothing (no rate limiter touched, no IGDB
 *     call) — the common case stays inexpensive.
 *  2. Only an actual IGDB-hitting path (true miss, or a stale row needing
 *     refresh) consumes a per-client rate-limit bucket
 *     (`src/lib/rate-limit.ts`, reused — this genuinely is a per-caller
 *     bucket, unlike the global IGDB rate limiter).
 *  3. Rate-limited with a stale cached row present -> serve the stale row
 *     rather than failing (graceful degradation).
 *  4. Rate-limited with nothing cached at all -> throws
 *     `GameImportRateLimitedError`, which the page catches and renders a
 *     calm "try again shortly" message for — never a raw error.
 *
 * `clientId` is supplied by the caller (the page, via
 * `getClientIdentifier()`) rather than resolved here, so this function
 * stays a plain, easily-testable function with no `next/headers`
 * dependency of its own.
 */
export async function getOrImportGameBySlug(
  slug: string,
  clientId: string,
): Promise<GameRow | null> {
  const cached = await findCachedGameBySlug(slug);
  if (cached && !isStale(cached.igdb_synced_at)) {
    return cached;
  }

  const rate = checkImportRateLimit(clientId);
  if (!rate.allowed) {
    if (cached) return cached;
    throw new GameImportRateLimitedError();
  }

  if (cached) {
    return importGameByIgdbId(cached.igdb_id);
  }
  return importGameBySlug(slug);
}
