import "server-only";
import { z } from "zod";
import { igdbRequest } from "./client";
import { buildSearchQuery } from "./apicalypse";
import { mapIgdbSearchResult } from "./mappers";
import { excludeUnwantedGameTypes, rankSearchResults } from "./ranking";
import { normalizeGameName } from "./normalize";
import { getCachedSearch, setCachedSearch } from "./search-cache";
import type { GameSearchResult, IgdbGameSearchRaw } from "./types";

const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;

const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/**
 * Server-only IGDB search wrapper: validates and caps input, checks a
 * short-TTL in-memory cache, queries IGDB with a fixed field list
 * (apicalypse.ts — no arbitrary query is ever accepted), drops obviously
 * unwanted types (bundle/mod/pack) using the real returned data, and ranks
 * the remainder so exact/prefix matches outrank IGDB's own fuzzy ordering.
 *
 * Returns the full overfetched, ranked, filtered pool (up to
 * `buildSearchQuery`'s own overfetch cap) — deliberately NOT truncated to
 * `limit` here. `game-catalogue.ts`'s `searchGames` merges this with local
 * results and performs exactly one final rank+truncate; truncating here
 * too meant a genuinely relevant but not-yet-cached candidate's survival
 * depended entirely on which arbitrary subset IGDB's own live, not
 * perfectly stable relevance ordering happened to deliver in one specific
 * call, with no chance to be reconsidered once merged with local matches
 * (the confirmed cause of a real "lego star war" inconsistency between the
 * quick-search dialog and full Standard search — see docs/PINECONE.md's...
 * actually see docs/PROJECT_STATE.md's changelog entry for the incident).
 */
export async function searchIgdbGames(
  query: string,
  opts?: { limit?: number },
): Promise<GameSearchResult[]> {
  const parsed = searchInputSchema.parse({ query, limit: opts?.limit });
  const cacheKey = `${normalizeGameName(parsed.query)}::${parsed.limit}`;

  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  const raw = await igdbRequest<IgdbGameSearchRaw>(
    "games",
    buildSearchQuery(parsed.query, parsed.limit),
  );

  const mapped = raw.map(mapIgdbSearchResult);
  const filtered = excludeUnwantedGameTypes(mapped);
  const ranked = rankSearchResults(parsed.query, filtered);

  setCachedSearch(cacheKey, ranked);
  return ranked;
}
