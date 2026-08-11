import "server-only";
import type { GameSearchResult } from "./types";

const TTL_MS = 60_000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  expiresAt: number;
  results: GameSearchResult[];
}

/** In-memory, single-instance cache for repeat searches — dampens IGDB calls for trending/repeated queries within the rate budget. */
const cache = new Map<string, CacheEntry>();

export function getCachedSearch(key: string): GameSearchResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.results;
}

export function setCachedSearch(
  key: string,
  results: GameSearchResult[],
): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + TTL_MS, results });
}

/** Test-only: clears the cache so tests don't leak state into each other. */
export function _resetIgdbSearchCacheForTests() {
  cache.clear();
}
