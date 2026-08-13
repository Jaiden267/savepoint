import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureConfiguredIndex } from "@/lib/pinecone/client";
import { buildCatalogueRecordId } from "@/lib/pinecone/constants";
import { pineconeCatalogueRecordSchema } from "@/lib/validation/games";
import {
  createSeededRandom,
  pickKeysetThresholds,
  seededShuffle,
  type Rng,
} from "@/lib/random/seeded-random";
import { normalizeGameName } from "@/lib/igdb/normalize";
import {
  toSearchResult,
  checkDiscoverRateLimit,
} from "@/server/services/game-catalogue";
import { getCachedSearch, setCachedSearch } from "@/lib/igdb/search-cache";
import type { GameSearchResult } from "@/lib/igdb/types";

/**
 * Bounded random sampling of the full synced Balanced catalogue for
 * /discover — see docs/PINECONE.md's "Discover page" section for the
 * full design rationale. Every constant below is a genuine, asserted
 * ceiling, not a loose target: this module never scans/transfers the
 * whole ~27k-row ledger, never loops unboundedly, and never issues a
 * per-card request.
 */
const TARGET_SELECTION_SIZE = 24;
/** At or above this many valid, hydrated results, the selection renders normally with no notice. */
const FULL_RESULT_FLOOR = 20;
const INITIAL_WINDOW_COUNT = 4;
/** 4 × 8 = 32 raw candidates on the common path — comfortable buffer over the 24 target. */
const WINDOW_LIMIT = 8;
/** Exactly one additional bounded round, never a retry loop. */
const MAX_REFILL_ROUNDS = 1;
const REFILL_WINDOW_COUNT = 2;
/** Diversity-pass soft caps — preferences, never hard exclusions (see applyDiversityPass). */
const FRANCHISE_KEY_CAP = 3;
const YEAR_CAP = 4;
const PLATFORM_CAP = 5;

const CACHE_KEY_PREFIX = "discover:";

/** Ledger read failed, or zero valid catalogue records could be obtained even after the bounded refill — a genuine unavailability, not a merely-reduced count. */
export class DiscoverCatalogueUnavailableError extends Error {}

/** The separately-keyed Discover rate limit (checkDiscoverRateLimit) was exceeded for an uncached seed. */
export class DiscoverRateLimitedError extends Error {}

export interface DiscoverCatalogueResult {
  results: GameSearchResult[];
  /** True when 0 < results.length < FULL_RESULT_FLOOR — render results as-is with an honest "fewer than usual" notice, never a fallback. */
  reduced: boolean;
}

interface LedgerBounds {
  min: number;
  max: number;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Selects exactly `igdb_id` — never any other ledger column — from `status='synced'` rows, ordered and range-bounded. One indexed seek per call. */
async function queryLedgerWindow(
  admin: AdminClient,
  bounds: { gte: number; lt?: number },
  limit: number,
): Promise<number[]> {
  let query = admin
    .from("igdb_catalogue_sync")
    .select("igdb_id")
    .eq("status", "synced")
    .gte("igdb_id", bounds.gte);
  if (bounds.lt !== undefined) {
    query = query.lt("igdb_id", bounds.lt);
  }
  const { data, error } = await query
    .order("igdb_id", { ascending: true })
    .limit(limit);
  if (error) {
    throw new DiscoverCatalogueUnavailableError(
      `catalogue ledger window query failed: ${error.message}`,
    );
  }
  return (data ?? []).map((row) => row.igdb_id);
}

/** The synced-status id range, via two single-row indexed queries (no native MIN/MAX aggregate through PostgREST). Returns null for a genuinely empty ledger. */
async function fetchLedgerBounds(
  admin: AdminClient,
): Promise<LedgerBounds | null> {
  const [minResult, maxResult] = await Promise.all([
    admin
      .from("igdb_catalogue_sync")
      .select("igdb_id")
      .eq("status", "synced")
      .order("igdb_id", { ascending: true })
      .limit(1),
    admin
      .from("igdb_catalogue_sync")
      .select("igdb_id")
      .eq("status", "synced")
      .order("igdb_id", { ascending: false })
      .limit(1),
  ]);
  if (minResult.error || maxResult.error) {
    throw new DiscoverCatalogueUnavailableError(
      `catalogue ledger bounds query failed: ${
        minResult.error?.message ?? maxResult.error?.message
      }`,
    );
  }
  const min = minResult.data?.[0]?.igdb_id;
  const max = maxResult.data?.[0]?.igdb_id;
  if (min === undefined || max === undefined) return null;
  return { min, max };
}

/**
 * Draws one bounded sampling round: `windowCount` independent keyset
 * windows, each with at most one deterministic wrap-around query if it
 * under-delivers (never a new random point — always wraps to the global
 * `min`), filtered against `attemptedIds` (mutated in place — every id
 * this function returns is immediately added, so a later round, if any,
 * never re-draws or re-hydrates it) and shuffled before returning. Exactly
 * `windowCount` primary queries plus at most `windowCount` wrap-around
 * queries — bounded, not a loop.
 */
async function runSamplingRound(
  admin: AdminClient,
  rng: Rng,
  bounds: LedgerBounds,
  windowCount: number,
  windowLimit: number,
  attemptedIds: Set<number>,
): Promise<number[]> {
  const thresholds = pickKeysetThresholds(
    rng,
    bounds.min,
    bounds.max,
    windowCount,
  );
  const windowResults = await Promise.all(
    thresholds.map(async (threshold) => {
      const primary = await queryLedgerWindow(
        admin,
        { gte: threshold },
        windowLimit,
      );
      if (primary.length >= windowLimit) return primary;
      // Deterministic wrap-around: threshold was near `max`, not enough
      // rows remain above it — top up from the global min, never a new
      // random point. At most one supplemental query per window.
      const wrapped = await queryLedgerWindow(
        admin,
        { gte: bounds.min, lt: threshold },
        windowLimit - primary.length,
      );
      return primary.concat(wrapped);
    }),
  );

  const newIds: number[] = [];
  for (const ids of windowResults) {
    for (const id of ids) {
      if (attemptedIds.has(id)) continue;
      attemptedIds.add(id);
      newIds.push(id);
    }
  }
  return seededShuffle(rng, newIds);
}

interface DiversityCandidate {
  result: GameSearchResult;
  franchiseKey: string;
  releaseYear: number | null;
  platform: string | null;
  hasCoverAndYear: boolean;
}

/** Loosely-typed Pinecone record metadata read opportunistically for the diversity pass — never required, never validated as strictly as pineconeCatalogueRecordSchema. */
interface OptionalDiversityFields {
  genres?: unknown;
  platforms?: unknown;
}

function firstPlatform(
  metadata: OptionalDiversityFields | undefined,
): string | null {
  const platforms = metadata?.platforms;
  if (Array.isArray(platforms) && typeof platforms[0] === "string") {
    return platforms[0];
  }
  return null;
}

function franchiseKeyFor(name: string): string {
  const normalized = normalizeGameName(name);
  return normalized.split(" ").slice(0, 2).join(" ") || normalized;
}

/**
 * Hydrates a batch of igdb_ids in exactly one Pinecone `fetch` + one
 * `games` lookup (never per-card). A `games` row present → cached result
 * (real stored slug); absent but Pinecone metadata passes
 * `pineconeCatalogueRecordSchema` → catalogue-only result; neither →
 * dropped. Order of `ids` is preserved in the output for candidates that
 * hydrate successfully.
 */
async function hydrateIds(
  supabase: SupabaseClient<Database>,
  ids: number[],
): Promise<DiversityCandidate[]> {
  if (ids.length === 0) return [];

  const namespace = await ensureConfiguredIndex();
  const pineconeIds = ids.map(buildCatalogueRecordId);

  const [fetchResult, gamesResult] = await Promise.all([
    namespace.fetch({ ids: pineconeIds }),
    supabase
      .from("games")
      .select(
        "igdb_id, slug, name, cover_image_id, release_date, igdb_game_type, version_parent_igdb_id",
      )
      .in("igdb_id", ids),
  ]);

  const gameRows = gamesResult.data ?? [];
  const byIgdbId = new Map(gameRows.map((row) => [row.igdb_id, row]));
  const pineconeRecords = fetchResult.records ?? {};

  const candidates: DiversityCandidate[] = [];
  for (const igdbId of ids) {
    const gameRow = byIgdbId.get(igdbId);
    if (gameRow) {
      const result = toSearchResult(gameRow);
      candidates.push({
        result,
        franchiseKey: franchiseKeyFor(result.name),
        releaseYear: result.releaseYear,
        platform: null,
        hasCoverAndYear: Boolean(
          result.coverImageId && result.releaseYear !== null,
        ),
      });
      continue;
    }

    const record = pineconeRecords[buildCatalogueRecordId(igdbId)];
    if (!record) continue;
    const parsed = pineconeCatalogueRecordSchema.safeParse(record.metadata);
    if (!parsed.success) continue;
    const data = parsed.data;
    const result: GameSearchResult = {
      source: "igdb",
      igdbId: data.igdb_id,
      slug: data.slug,
      name: data.name,
      coverImageId: data.cover_image_id ?? null,
      releaseYear: data.release_year ?? null,
      gameType: null,
      versionParentIgdbId: null,
    };
    candidates.push({
      result,
      franchiseKey: franchiseKeyFor(result.name),
      releaseYear: result.releaseYear,
      platform: firstPlatform(record.metadata as OptionalDiversityFields),
      hasCoverAndYear: Boolean(
        result.coverImageId && result.releaseYear !== null,
      ),
    });
  }
  return candidates;
}

/**
 * Reorders `candidates` to reduce (never guarantee) domination by one
 * franchise/title-family, release year, or platform — keyset sampling
 * alone says nothing about diversity *within* one selection, only about
 * variety *across* different seeds. A soft preference, applied greedily
 * over the already-shuffled input: candidates with both artwork and a
 * release year present are preferred first (stable — ties keep shuffle
 * order), then a per-key cap is respected where possible. Never drops a
 * candidate and never returns fewer than `target` when `candidates.length
 * >= target` — deferred (over-cap) candidates still fill remaining slots.
 * Distinct igdb_ids sharing a name are never excluded by this pass —
 * franchiseKey only ever influences order.
 */
function applyDiversityPass(
  candidates: DiversityCandidate[],
  target: number,
): GameSearchResult[] {
  const ordered = candidates
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      if (a.c.hasCoverAndYear !== b.c.hasCoverAndYear) {
        return a.c.hasCoverAndYear ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ c }) => c);

  const franchiseCounts = new Map<string, number>();
  const yearCounts = new Map<number, number>();
  const platformCounts = new Map<string, number>();
  const chosen: DiversityCandidate[] = [];
  const deferred: DiversityCandidate[] = [];

  for (const c of ordered) {
    const franchiseOk =
      (franchiseCounts.get(c.franchiseKey) ?? 0) < FRANCHISE_KEY_CAP;
    const yearOk =
      c.releaseYear === null || (yearCounts.get(c.releaseYear) ?? 0) < YEAR_CAP;
    const platformOk =
      c.platform === null ||
      (platformCounts.get(c.platform) ?? 0) < PLATFORM_CAP;

    if (franchiseOk && yearOk && platformOk && chosen.length < target) {
      chosen.push(c);
      franchiseCounts.set(
        c.franchiseKey,
        (franchiseCounts.get(c.franchiseKey) ?? 0) + 1,
      );
      if (c.releaseYear !== null) {
        yearCounts.set(c.releaseYear, (yearCounts.get(c.releaseYear) ?? 0) + 1);
      }
      if (c.platform !== null) {
        platformCounts.set(
          c.platform,
          (platformCounts.get(c.platform) ?? 0) + 1,
        );
      }
    } else {
      deferred.push(c);
    }
  }

  for (const c of deferred) {
    if (chosen.length >= target) break;
    chosen.push(c);
  }

  return chosen.map((c) => c.result);
}

/**
 * The full bounded random-selection algorithm — see docs/PINECONE.md's
 * "Discover page" section. Order of operations, all required:
 *
 *  1. Cache check (`discover:${seed}`) — a hit returns immediately, no
 *     rate-limit check, no ledger/Pinecone/games call at all.
 *  2. On a miss, the Discover rate limit (checkDiscoverRateLimit) — not
 *     allowed throws DiscoverRateLimitedError before any external call.
 *  3. Ledger bounds, one sampling round (with wrap-around), hydration.
 *  4. If hydrated count < FULL_RESULT_FLOOR, exactly one bounded refill
 *     round (new ids only, excludes everything already attempted).
 *  5. A ledger/Pinecone error, or zero valid results even after refill,
 *     throws DiscoverCatalogueUnavailableError — the only fallback
 *     triggers. Any nonzero count, even below FULL_RESULT_FLOOR, is a
 *     genuine (if reduced) result, cached and returned normally.
 *
 * `seed` must already be validated (discoverSeedSchema) by the caller —
 * this function's signature only accepts a plain validated number, so
 * there is no path for a malformed value to reach the cache key.
 */
export async function listDiscoverCatalogue(
  supabase: SupabaseClient<Database>,
  { seed, clientId }: { seed: number; clientId: string },
): Promise<DiscoverCatalogueResult> {
  const cacheKey = `${CACHE_KEY_PREFIX}${seed}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    return {
      results: cached,
      reduced: cached.length > 0 && cached.length < FULL_RESULT_FLOOR,
    };
  }

  const rate = checkDiscoverRateLimit(clientId);
  if (!rate.allowed) {
    throw new DiscoverRateLimitedError();
  }

  const admin = createAdminClient();
  const bounds = await fetchLedgerBounds(admin);
  if (!bounds) {
    throw new DiscoverCatalogueUnavailableError(
      "catalogue ledger has no synced records",
    );
  }

  const rng = createSeededRandom(seed);
  const attemptedIds = new Set<number>();

  const firstRoundIds = await runSamplingRound(
    admin,
    rng,
    bounds,
    INITIAL_WINDOW_COUNT,
    WINDOW_LIMIT,
    attemptedIds,
  );
  let candidates = await hydrateIds(supabase, firstRoundIds);

  if (candidates.length < FULL_RESULT_FLOOR) {
    for (let round = 0; round < MAX_REFILL_ROUNDS; round++) {
      const refillIds = await runSamplingRound(
        admin,
        rng,
        bounds,
        REFILL_WINDOW_COUNT,
        WINDOW_LIMIT,
        attemptedIds,
      );
      if (refillIds.length === 0) break;
      const more = await hydrateIds(supabase, refillIds);
      candidates = candidates.concat(more);
    }
  }

  if (candidates.length === 0) {
    throw new DiscoverCatalogueUnavailableError(
      "no valid catalogue records could be hydrated",
    );
  }

  const target = Math.min(TARGET_SELECTION_SIZE, candidates.length);
  const results = applyDiversityPass(candidates, target);
  const reduced = results.length > 0 && results.length < FULL_RESULT_FLOOR;

  setCachedSearch(cacheKey, results);
  return { results, reduced };
}
