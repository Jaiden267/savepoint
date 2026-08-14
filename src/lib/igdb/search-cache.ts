import "server-only";
import type { GameSearchResult } from "./types";

const TTL_MS = 60_000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  expiresAt: number;
  results: unknown[];
}

/**
 * In-memory, single-instance cache for repeat searches — dampens IGDB/
 * Pinecone calls for trending/repeated queries within the rate budget.
 * Generic (default `GameSearchResult`, matching every existing caller's
 * behavior exactly) so a caller storing a differently-shaped result array
 * — e.g. src/server/services/recommendations.ts's `RecommendationResult`,
 * which extends `GameSearchResult` with a `reason` — can round-trip its
 * own type through the same shared cache without an unsafe cast. Prefixed
 * keys (`discover:`, `recommendations:${userId}:`, ...) keep each
 * feature's entries from ever being read back as the wrong shape.
 */
const cache = new Map<string, CacheEntry>();

export function getCachedSearch<T = GameSearchResult>(key: string): T[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.results as T[];
}

export function setCachedSearch<T = GameSearchResult>(
  key: string,
  results: T[],
): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + TTL_MS, results });
}

/**
 * Removes every cached entry whose key starts with `prefix` — used for
 * immediate cache invalidation when a mutation (rating, library status,
 * review, recommendation feedback) makes a user's cached results stale
 * rather than waiting out TTL_MS. Prefix-scoped and nothing else: a
 * `recommendations:${userId}:` prefix can never touch `discover:`-prefixed
 * entries or another user's `recommendations:`-prefixed ones, since the
 * userId is baked into the prefix itself.
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Test-only: clears the cache so tests don't leak state into each other. */
export function _resetIgdbSearchCacheForTests() {
  cache.clear();
}
