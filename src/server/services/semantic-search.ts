import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  searchGameIds,
  PineconeSearchError,
  type PineconeHit,
} from "@/lib/pinecone/search";
import { PineconeIndexUnavailableError } from "@/lib/pinecone/client";
import {
  searchLocalGames,
  toSearchResult,
} from "@/server/services/game-catalogue";
import {
  semanticSearchQuerySchema,
  semanticSearchTopKSchema,
  pineconeCatalogueRecordSchema,
} from "@/lib/validation/games";
import type { GameSearchResult } from "@/lib/igdb/types";

const SEMANTIC_SEARCH_RATE_LIMIT = { limit: 20, windowSeconds: 60 };
const LEXICAL_FALLBACK_LIMIT = 20;

export interface SemanticSearchOutcome {
  mode: "semantic" | "lexical_fallback";
  results: GameSearchResult[];
}

/**
 * Builds a catalogue-only search result straight from a Pinecone hit's own
 * (validated) metadata, for a game with no matching Supabase row. Never
 * carries rating/review/activity data — search results never have, for any
 * source — and `gameType`/`versionParentIgdbId` are null since Pinecone's
 * own rank order is used as-is here, never re-ranked the way lexical
 * results are.
 */
function toCatalogueResult(hit: PineconeHit): GameSearchResult | null {
  const parsed = pineconeCatalogueRecordSchema.safeParse(hit.fields);
  if (!parsed.success) return null;
  const record = parsed.data;
  return {
    source: "igdb",
    igdbId: record.igdb_id,
    slug: record.slug,
    name: record.name,
    coverImageId: record.cover_image_id ?? null,
    releaseYear: record.release_year ?? null,
    gameType: null,
    versionParentIgdbId: null,
  };
}

/**
 * `supabase` is the caller's request-scoped, RLS-authenticated client
 * (never the admin client, never an internally-constructed/global one) —
 * `games` is public-readable so no elevated access is needed. The Pinecone
 * module (src/lib/pinecone/search.ts) returns ordered hits keyed by
 * `igdb_id` only; this is the one place that turns those back into
 * renderable results, either a real Supabase row (the common, already-
 * cached case) or — new in Prompt 7C — a catalogue-only result built
 * directly from validated Pinecone metadata for a game Savepoint has never
 * cached, instead of silently dropping it.
 */
export async function searchGamesSemantic(
  supabase: SupabaseClient<Database>,
  { query, topK, clientId }: { query: string; topK?: number; clientId: string },
): Promise<SemanticSearchOutcome> {
  const parsedQuery = semanticSearchQuerySchema.safeParse(query);
  const parsedTopK = semanticSearchTopKSchema.safeParse(topK);
  if (!parsedQuery.success || !parsedTopK.success) {
    return { mode: "semantic", results: [] };
  }

  // Rate-limit failures degrade straight to lexical search — no error
  // surfaced, no internal detail exposed.
  const rate = checkRateLimit(
    `semantic-search:${clientId}`,
    SEMANTIC_SEARCH_RATE_LIMIT,
  );
  if (!rate.allowed) {
    return lexicalFallback(parsedQuery.data);
  }

  let hits;
  try {
    hits = await searchGameIds(parsedQuery.data, parsedTopK.data);
  } catch (err) {
    if (
      err instanceof PineconeIndexUnavailableError ||
      err instanceof PineconeSearchError
    ) {
      return lexicalFallback(parsedQuery.data);
    }
    throw err;
  }

  if (hits.length === 0) {
    return { mode: "semantic", results: [] };
  }

  // Hydrate by igdb_id — a plain integer column, correct regardless of
  // whether the hit came from a v1 (raw Supabase UUID id) or v2
  // (`igdb-${igdbId}` id) Pinecone record. Never .in("id", ...): a v2
  // hit's top-level record id is not a UUID, and passing it into a UUID
  // column filter would throw a Postgres invalid-input error rather than
  // gracefully returning no rows.
  const igdbIds = hits.map((hit) => hit.igdbId);
  const { data: rows } = await supabase
    .from("games")
    .select(
      "id, igdb_id, slug, name, cover_image_id, release_date, igdb_game_type, version_parent_igdb_id",
    )
    .in("igdb_id", igdbIds);

  const byIgdbId = new Map((rows ?? []).map((row) => [row.igdb_id, row]));

  // Re-order to match Pinecone's hit order. A hit whose igdb_id has a live
  // Supabase row renders from that row (unchanged from before); one that
  // doesn't renders from its own validated Pinecone metadata as a
  // catalogue-only result instead of being dropped; one that matches
  // neither is dropped, same fail-safe behaviour as before, just narrowed
  // to only the cases that still can't be resolved. Deduped by igdb_id
  // afterward, keeping the first (highest-ranked) occurrence — relevant
  // during the v1-to-v2 transition window, where a legacy and a
  // newly-discovered record for the same game could briefly both exist.
  const seenIgdbIds = new Set<number>();
  const results: GameSearchResult[] = [];
  for (const hit of hits) {
    if (seenIgdbIds.has(hit.igdbId)) continue;

    const row = byIgdbId.get(hit.igdbId);
    const result = row ? toSearchResult(row) : toCatalogueResult(hit);
    if (!result) continue;

    seenIgdbIds.add(hit.igdbId);
    results.push(result);
  }

  return { mode: "semantic", results };
}

async function lexicalFallback(query: string): Promise<SemanticSearchOutcome> {
  const results = await searchLocalGames(query, LEXICAL_FALLBACK_LIMIT);
  return { mode: "lexical_fallback", results };
}
