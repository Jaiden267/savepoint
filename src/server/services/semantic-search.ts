import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { checkRateLimit } from "@/lib/rate-limit";
import { searchGameIds, PineconeSearchError } from "@/lib/pinecone/search";
import { PineconeIndexUnavailableError } from "@/lib/pinecone/client";
import {
  searchLocalGames,
  toSearchResult,
} from "@/server/services/game-catalogue";
import {
  semanticSearchQuerySchema,
  semanticSearchTopKSchema,
} from "@/lib/validation/games";
import type { GameSearchResult } from "@/lib/igdb/types";

const SEMANTIC_SEARCH_RATE_LIMIT = { limit: 20, windowSeconds: 60 };
const LEXICAL_FALLBACK_LIMIT = 20;

export interface SemanticSearchOutcome {
  mode: "semantic" | "lexical_fallback";
  results: GameSearchResult[];
}

/**
 * `supabase` is the caller's request-scoped, RLS-authenticated client
 * (never the admin client, never an internally-constructed/global one) —
 * `games` is public-readable so no elevated access is needed. The Pinecone
 * module (src/lib/pinecone/search.ts) returns ordered ids only; this is the
 * one place that turns those ids back into real Supabase rows.
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

  const gameIds = hits.map((hit) => hit.gameId);
  const { data: rows } = await supabase
    .from("games")
    .select(
      "id, igdb_id, slug, name, cover_image_id, release_date, igdb_game_type, version_parent_igdb_id",
    )
    .in("id", gameIds);

  const byId = new Map((rows ?? []).map((row) => [row.id, row]));

  // Re-order to match Pinecone's hit order; drop any id Pinecone returned
  // that Supabase no longer has (stale-index self-heal — Supabase is
  // authoritative).
  const results: GameSearchResult[] = [];
  for (const hit of hits) {
    const row = byId.get(hit.gameId);
    if (row) results.push(toSearchResult(row));
  }

  return { mode: "semantic", results };
}

async function lexicalFallback(query: string): Promise<SemanticSearchOutcome> {
  const results = await searchLocalGames(query, LEXICAL_FALLBACK_LIMIT);
  return { mode: "lexical_fallback", results };
}
