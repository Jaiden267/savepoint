import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  searchGameHits,
  PineconeSearchError,
  type StructuredGameHit,
} from "@/lib/pinecone/search";
import { ensureConfiguredIndex } from "@/lib/pinecone/client";
import { buildCatalogueRecordId } from "@/lib/pinecone/constants";
import { getCachedSearch, setCachedSearch } from "@/lib/igdb/search-cache";
import { toSearchResult } from "@/server/services/game-catalogue";
import type { GameSearchResult } from "@/lib/igdb/types";

/**
 * Recommendations-specific unavailability — thrown for a genuine failure
 * (zero valid candidates survive exclusion/hydration, or an upstream
 * Pinecone error not already one of the SDK's own typed errors). Callers
 * also catch PineconeIndexUnavailableError/PineconeSearchError directly,
 * mirroring src/app/discover/discover-results.tsx's exact pattern.
 */
export class RecommendationsUnavailableError extends Error {}

/** The recommendations generation rate limit (checkRecommendationsRateLimit) was exceeded for an uncached seed. */
export class RecommendationsRateLimitedError extends Error {}

const CACHE_KEY_PREFIX = "recommendations:";
const RECOMMENDATIONS_RATE_LIMIT = { limit: 15, windowSeconds: 60 };

export function checkRecommendationsRateLimit(clientId: string) {
  return checkRateLimit(
    `recommendations:${clientId}`,
    RECOMMENDATIONS_RATE_LIMIT,
  );
}

/** How many raw Pinecone candidates are requested per generation — deliberately overfetches CANDIDATE_TOPK/TARGET_SIZE-worth of headroom so post-exclusion filtering doesn't routinely leave a thin page, while staying one bounded call. */
const CANDIDATE_TOPK = 60;
const TARGET_SIZE = 20;
/** At or above this many valid results, the selection renders normally with no "showing fewer" notice — mirrors discover-catalogue.ts's FULL_RESULT_FLOOR. */
const FULL_RESULT_FLOOR = 12;
/** Fewer positive signals than this triggers the cold-start experience. */
const COLD_START_THRESHOLD = 3;
/** A `shown` feedback row this recent excludes the game from being surfaced again — the session-repeat guard. Exported for reuse as the impression-idempotency window in src/server/actions/recommendations.ts (see that file's doc comment for why the same window is correct for both purposes). */
export const SHOWN_EXCLUSION_WINDOW_MS = 60 * 60 * 1000;
/** A real ceiling on how many `saved`-feedback games feed the taste profile, not "as many as exist." */
const MAX_SAVED_SIGNALS = 20;
/** Character budget for the synthesized Pinecone query text — deliberately much smaller than record-text.ts's MAX_TEXT_CHARS, since this is a short natural-language description, not a full game description. */
const MAX_QUERY_CHARS = 400;

const STRONG_POSITIVE_WEIGHT = 3;
const WEAK_POSITIVE_WEIGHT = 1;
const VERY_WEAK_POSITIVE_WEIGHT = 0.3;
const NEGATIVE_WEIGHT = 2;
const STRONG_RATING_THRESHOLD = 8;
const NEGATIVE_RATING_THRESHOLD = 3;
const NEGATIVE_TAG_PENALTY_K = 1.0;
const RANKING_ALPHA = 0.6;

type ReasonHint = "rated" | "completed" | "saved";

interface StrongSignalGame {
  name: string;
  tags: Set<string>;
  weight: number;
  hint: ReasonHint;
}

export interface TasteProfile {
  positiveTags: Map<string, number>;
  negativeTags: Map<string, number>;
  strongSignalGames: StrongSignalGame[];
  positiveSignalCount: number;
}

export interface RecommendationResult extends GameSearchResult {
  reason: string;
}

export interface RecommendationsOutcome {
  results: RecommendationResult[];
  mode: "personalized" | "preference-assisted";
  reduced: boolean;
  coldStart: boolean;
}

/** min-max normalize values into [0,1]; a tie (including a single-value array) maps every value to 0.5 rather than dividing by zero. */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

function tierFromRating(rating: number): "strong" | "weak" | "negative" {
  if (rating >= STRONG_RATING_THRESHOLD) return "strong";
  if (rating <= NEGATIVE_RATING_THRESHOLD) return "negative";
  return "weak";
}

interface GameSignal {
  weight: number;
  hint: ReasonHint;
  isNegative: boolean;
}

/**
 * One game can accumulate multiple raw signals (a rating, a diary entry,
 * a library status) — merged to exactly one signal per game rather than
 * summed, so a heavily-diaried game can't dominate the profile purely
 * from repeated logging. An explicit rating (wherever it appears) always
 * wins over a status-derived tier, since it's a more deliberate
 * expression of opinion than the mere act of tracking/finishing a game.
 */
function mergeGameSignal(
  existing: GameSignal | undefined,
  candidate: GameSignal,
): GameSignal {
  if (!existing) return candidate;
  // A rating-derived signal always wins over a status-derived one.
  if (candidate.hint === "rated" && existing.hint !== "rated") return candidate;
  if (existing.hint === "rated" && candidate.hint !== "rated") return existing;
  return candidate.weight > existing.weight ? candidate : existing;
}

interface NamedRefRow {
  id: number;
  name: string;
}

/**
 * Batched genre/game_mode tag lookup for a set of *already-imported* game
 * ids (never a catalogue-only game — those have no games row, and their
 * tags come from the separate bounded Pinecone fetch in
 * fetchCatalogueOnlyTags below). Two join queries plus two reference-table
 * queries total, regardless of how many games — never one query per game.
 */
async function fetchTagsForGames(
  supabase: SupabaseClient<Database>,
  gameIds: string[],
): Promise<Map<string, string[]>> {
  const tagsByGameId = new Map<string, string[]>();
  for (const id of gameIds) tagsByGameId.set(id, []);
  if (gameIds.length === 0) return tagsByGameId;

  const [genreLinksResult, modeLinksResult] = await Promise.all([
    supabase
      .from("game_genres")
      .select("game_id, genre_id")
      .in("game_id", gameIds),
    supabase
      .from("game_game_modes")
      .select("game_id, game_mode_id")
      .in("game_id", gameIds),
  ]);
  const genreLinks = genreLinksResult.data ?? [];
  const modeLinks = modeLinksResult.data ?? [];

  const genreIds = [...new Set(genreLinks.map((l) => l.genre_id))];
  const modeIds = [...new Set(modeLinks.map((l) => l.game_mode_id))];

  const [genreRowsResult, modeRowsResult] = await Promise.all([
    genreIds.length > 0
      ? supabase.from("genres").select("id, name").in("id", genreIds)
      : Promise.resolve({ data: [] as NamedRefRow[] }),
    modeIds.length > 0
      ? supabase.from("game_modes").select("id, name").in("id", modeIds)
      : Promise.resolve({ data: [] as NamedRefRow[] }),
  ]);
  const genreNameById = new Map(
    (genreRowsResult.data ?? []).map((r) => [r.id, r.name]),
  );
  const modeNameById = new Map(
    (modeRowsResult.data ?? []).map((r) => [r.id, r.name]),
  );

  for (const link of genreLinks) {
    const name = genreNameById.get(link.genre_id);
    if (name) tagsByGameId.get(link.game_id)?.push(name);
  }
  for (const link of modeLinks) {
    const name = modeNameById.get(link.game_mode_id);
    if (name) tagsByGameId.get(link.game_id)?.push(name);
  }
  return tagsByGameId;
}

interface CatalogueOnlyTagResult {
  name: string;
  tags: string[];
}

/**
 * Tags for `saved`-feedback games that had no games row at save time — one
 * bounded Pinecone metadata `fetch` (a lookup by known canonical id, never
 * a search), matching discover-catalogue.ts's hydration precedent exactly.
 * Never writes to public.games. A Pinecone hiccup here degrades to "no
 * catalogue-only saved tags this request" rather than failing the whole
 * taste profile — the rest of the profile (already-imported signal games)
 * is unaffected.
 */
async function fetchCatalogueOnlyTags(
  igdbIds: number[],
): Promise<Map<number, CatalogueOnlyTagResult>> {
  const result = new Map<number, CatalogueOnlyTagResult>();
  if (igdbIds.length === 0) return result;

  try {
    const namespace = await ensureConfiguredIndex();
    const fetchResult = await namespace.fetch({
      ids: igdbIds.map(buildCatalogueRecordId),
    });
    const records = fetchResult.records ?? {};
    for (const igdbId of igdbIds) {
      const record = records[buildCatalogueRecordId(igdbId)];
      const metadata = record?.metadata as
        { name?: unknown; genres?: unknown; game_modes?: unknown } | undefined;
      if (!metadata || typeof metadata.name !== "string") continue;
      const genres = Array.isArray(metadata.genres)
        ? metadata.genres.filter((g): g is string => typeof g === "string")
        : [];
      const gameModes = Array.isArray(metadata.game_modes)
        ? metadata.game_modes.filter((m): m is string => typeof m === "string")
        : [];
      result.set(igdbId, {
        name: metadata.name,
        tags: [...genres, ...gameModes],
      });
    }
  } catch {
    // Degrade gracefully — see doc comment above.
  }
  return result;
}

/**
 * Reads every signal source (ratings, library status, diary, reviews,
 * review_likes, and — the "Helpful" fix — `saved` recommendation
 * feedback, including catalogue-only saves resolved via a bounded
 * Pinecone metadata fetch rather than ever importing them) and produces
 * weighted positive/negative tag maps plus a deterministically-ordered
 * list of "strong" signal games for reason generation. Request-scoped
 * client only — every table here already has correct RLS for it, no
 * admin client anywhere in this function.
 */
export async function buildUserTasteProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<TasteProfile> {
  const [
    userGamesResult,
    diaryResult,
    reviewsResult,
    likesResult,
    savedResult,
  ] = await Promise.all([
    supabase
      .from("user_games")
      .select("game_id, status, rating")
      .eq("user_id", userId),
    supabase
      .from("diary_entries")
      .select("game_id, rating")
      .eq("user_id", userId),
    supabase.from("reviews").select("game_id, rating").eq("user_id", userId),
    supabase.from("review_likes").select("review_id").eq("user_id", userId),
    supabase
      .from("recommendation_feedback")
      .select("igdb_id, game_id, created_at")
      .eq("user_id", userId)
      .eq("event_type", "saved")
      .order("created_at", { ascending: false })
      .limit(MAX_SAVED_SIGNALS),
  ]);

  // review_likes only carries review_id — resolve to game_id in one more
  // step (never a deep nested embed, matching game-refs.ts's own stated
  // convention of two safe steps over relying on multi-level embed
  // type-inference).
  const reviewIds = (likesResult.data ?? []).map((r) => r.review_id);
  const likedReviewGameIds =
    reviewIds.length > 0
      ? ((await supabase.from("reviews").select("game_id").in("id", reviewIds))
          .data ?? [])
      : [];

  const gameSignals = new Map<string, GameSignal>();

  function addSignal(gameId: string, signal: GameSignal) {
    gameSignals.set(gameId, mergeGameSignal(gameSignals.get(gameId), signal));
  }

  for (const row of userGamesResult.data ?? []) {
    if (row.rating !== null) {
      const tier = tierFromRating(row.rating);
      addSignal(row.game_id, {
        weight:
          tier === "strong" ? STRONG_POSITIVE_WEIGHT : WEAK_POSITIVE_WEIGHT,
        hint: "rated",
        isNegative: tier === "negative",
      });
    } else if (row.status === "completed") {
      addSignal(row.game_id, {
        weight: STRONG_POSITIVE_WEIGHT,
        hint: "completed",
        isNegative: false,
      });
    } else if (row.status === "dropped") {
      addSignal(row.game_id, {
        weight: NEGATIVE_WEIGHT,
        hint: "rated",
        isNegative: true,
      });
    } else if (
      row.status === "playing" ||
      row.status === "wishlist" ||
      row.status === "backlog" ||
      row.status === "paused"
    ) {
      addSignal(row.game_id, {
        weight: WEAK_POSITIVE_WEIGHT,
        hint: "completed",
        isNegative: false,
      });
    }
  }

  for (const row of diaryResult.data ?? []) {
    if (row.rating !== null) {
      const tier = tierFromRating(row.rating);
      addSignal(row.game_id, {
        weight:
          tier === "strong" ? STRONG_POSITIVE_WEIGHT : WEAK_POSITIVE_WEIGHT,
        hint: "rated",
        isNegative: tier === "negative",
      });
    } else {
      addSignal(row.game_id, {
        weight: WEAK_POSITIVE_WEIGHT,
        hint: "completed",
        isNegative: false,
      });
    }
  }

  for (const row of reviewsResult.data ?? []) {
    const tier = tierFromRating(row.rating);
    addSignal(row.game_id, {
      weight: tier === "strong" ? STRONG_POSITIVE_WEIGHT : WEAK_POSITIVE_WEIGHT,
      hint: "rated",
      isNegative: tier === "negative",
    });
  }

  for (const row of likedReviewGameIds) {
    const existing = gameSignals.get(row.game_id);
    if (!existing) {
      gameSignals.set(row.game_id, {
        weight: VERY_WEAK_POSITIVE_WEIGHT,
        hint: "completed",
        isNegative: false,
      });
    }
  }

  const importedGameIds = [...gameSignals.keys()];
  const tagsByGameId = await fetchTagsForGames(supabase, importedGameIds);

  // Names for the imported signal games, for the "strongSignalGames"
  // reason-generation list — one more batched query, by game id.
  const nameByGameId = new Map<string, string>();
  if (importedGameIds.length > 0) {
    const { data: nameRows } = await supabase
      .from("games")
      .select("id, name")
      .in("id", importedGameIds);
    for (const row of nameRows ?? []) nameByGameId.set(row.id, row.name);
  }

  const positiveTags = new Map<string, number>();
  const negativeTags = new Map<string, number>();
  const strongSignalGames: StrongSignalGame[] = [];
  let positiveSignalCount = 0;

  for (const [gameId, signal] of gameSignals) {
    const tags = tagsByGameId.get(gameId) ?? [];
    const targetMap = signal.isNegative ? negativeTags : positiveTags;
    for (const tag of tags) {
      targetMap.set(tag, (targetMap.get(tag) ?? 0) + signal.weight);
    }
    if (!signal.isNegative) {
      positiveSignalCount += 1;
      if (signal.weight >= STRONG_POSITIVE_WEIGHT) {
        const name = nameByGameId.get(gameId);
        if (name) {
          strongSignalGames.push({
            name,
            tags: new Set(tags),
            weight: signal.weight,
            hint: signal.hint,
          });
        }
      }
    }
  }

  // "Helpful" fix: saved-feedback games are a real, strong positive signal
  // (an explicit "keep recommending like this"), not just telemetry.
  const savedRows = savedResult.data ?? [];
  const savedWithGameId = savedRows.filter(
    (r): r is typeof r & { game_id: string } => r.game_id !== null,
  );
  const savedCatalogueOnly = savedRows.filter((r) => r.game_id === null);

  for (const row of savedWithGameId) {
    // Already imported at save time — reuse tags fetched above if this
    // game was also a signal source another way, else fetch fresh.
    const existingTags = tagsByGameId.get(row.game_id);
    const tags =
      existingTags ??
      (await fetchTagsForGames(supabase, [row.game_id])).get(row.game_id) ??
      [];
    for (const tag of tags) {
      positiveTags.set(
        tag,
        (positiveTags.get(tag) ?? 0) + STRONG_POSITIVE_WEIGHT,
      );
    }
    if (!gameSignals.has(row.game_id)) {
      positiveSignalCount += 1;
      const name =
        nameByGameId.get(row.game_id) ??
        (
          await supabase
            .from("games")
            .select("name")
            .eq("id", row.game_id)
            .maybeSingle()
        ).data?.name;
      if (name) {
        strongSignalGames.push({
          name,
          tags: new Set(tags),
          weight: STRONG_POSITIVE_WEIGHT,
          hint: "saved",
        });
      }
    }
  }

  if (savedCatalogueOnly.length > 0) {
    const catalogueTagsById = await fetchCatalogueOnlyTags(
      savedCatalogueOnly.map((r) => r.igdb_id),
    );
    for (const row of savedCatalogueOnly) {
      const info = catalogueTagsById.get(row.igdb_id);
      if (!info) continue;
      for (const tag of info.tags) {
        positiveTags.set(
          tag,
          (positiveTags.get(tag) ?? 0) + STRONG_POSITIVE_WEIGHT,
        );
      }
      positiveSignalCount += 1;
      strongSignalGames.push({
        name: info.name,
        tags: new Set(info.tags),
        weight: STRONG_POSITIVE_WEIGHT,
        hint: "saved",
      });
    }
  }

  strongSignalGames.sort(
    (a, b) => b.weight - a.weight || a.name.localeCompare(b.name),
  );

  return { positiveTags, negativeTags, strongSignalGames, positiveSignalCount };
}

/**
 * One deterministic natural-language string from the taste profile's
 * strongest signals — terms ordered by descending weight, deduped, never
 * repeated (token repetition doesn't reliably bias a dense embedding the
 * way it would a lexical/TF-IDF search, so this doesn't try to simulate
 * emphasis that way), capped at MAX_QUERY_CHARS. Pure, fully unit-testable
 * string-in/string-out.
 */
export function buildSyntheticQuery(profile: TasteProfile): string {
  const terms: string[] = [];
  const seen = new Set<string>();
  let length = 0;

  function tryAdd(term: string): boolean {
    if (!term) return true;
    if (seen.has(term)) return true;
    const additional = (terms.length > 0 ? 2 : 0) + term.length;
    if (length + additional > MAX_QUERY_CHARS) return false;
    seen.add(term);
    terms.push(term);
    length += additional;
    return true;
  }

  for (const game of profile.strongSignalGames) {
    if (!tryAdd(game.name)) break;
  }
  const topTags = [...profile.positiveTags.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
  for (const tag of topTags) {
    if (!tryAdd(tag)) break;
  }

  return terms.join(", ");
}

interface RankedCandidate {
  hit: StructuredGameHit;
  finalScore: number;
}

/**
 * Blends Pinecone's own relevance score with a tag-overlap adjustment —
 * never replaces Pinecone relevance with tag sums alone. Both components
 * are min-max normalized independently across this request's candidate
 * set before blending, so the result doesn't depend on assuming a
 * specific Pinecone score range. Never hard-drops for ranking reasons —
 * sort-then-truncate is the caller's job, this only orders.
 */
export function rankCandidates(
  hits: StructuredGameHit[],
  positiveTags: Map<string, number>,
  negativeTags: Map<string, number>,
): RankedCandidate[] {
  if (hits.length === 0) return [];

  const tagScores = hits.map((hit) => {
    const tags = [...hit.genres, ...hit.gameModes];
    let score = 0;
    for (const tag of tags) {
      score += positiveTags.get(tag) ?? 0;
      score -= NEGATIVE_TAG_PENALTY_K * (negativeTags.get(tag) ?? 0);
    }
    return score;
  });

  const normalizedPinecone = minMaxNormalize(hits.map((h) => h.score));
  const normalizedTag = minMaxNormalize(tagScores);

  const ranked = hits.map((hit, i) => ({
    hit,
    finalScore:
      RANKING_ALPHA * normalizedPinecone[i]! +
      (1 - RANKING_ALPHA) * normalizedTag[i]!,
  }));

  ranked.sort((a, b) => b.finalScore - a.finalScore);
  return ranked;
}

/**
 * Deterministic, no-LLM reason for one candidate — grounded only in real
 * stored signals. `genreHints`, when the profile itself has no signals
 * (preference-assisted mode), lets a candidate's reason cite the actual
 * selected genre rather than always falling to the generic line.
 */
export function generateReason(
  candidateTags: string[],
  profile: TasteProfile,
  genreHints?: string[],
): string {
  const candidateTagSet = new Set(candidateTags);

  for (const game of profile.strongSignalGames) {
    const overlaps = [...game.tags].some((t) => candidateTagSet.has(t));
    if (overlaps) {
      if (game.hint === "completed")
        return `Because you completed ${game.name}`;
      if (game.hint === "saved")
        return `Because you found ${game.name} helpful`;
      return `Because you rated ${game.name} highly`;
    }
  }

  const topPositiveTags = [...profile.positiveTags.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
  const matchingTags = topPositiveTags
    .filter((t) => candidateTagSet.has(t))
    .slice(0, 2);
  if (matchingTags.length > 0) {
    return `Matches your preference for ${matchingTags.join(" and ")}`;
  }

  if (genreHints && genreHints.length > 0) {
    const matchingHint = genreHints.find((g) => candidateTagSet.has(g));
    if (matchingHint) return `Matches your selected genre: ${matchingHint}`;
  }

  return "Recommended from the broad Savepoint catalogue";
}

/** Exclusion set: any igdb_id already in the user's library (any status), any igdb_id with dismissed/completed feedback, any igdb_id shown within the recent window. */
async function buildExclusionSet(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Set<number>> {
  const [libraryResult, feedbackResult] = await Promise.all([
    supabase
      .from("user_games")
      .select("games!inner(igdb_id)")
      .eq("user_id", userId),
    supabase
      .from("recommendation_feedback")
      .select("igdb_id, event_type, created_at")
      .eq("user_id", userId)
      .in("event_type", ["dismissed", "completed", "shown"]),
  ]);

  const excluded = new Set<number>();
  for (const row of libraryResult.data ?? []) {
    excluded.add(row.games.igdb_id);
  }

  const now = Date.now();
  for (const row of feedbackResult.data ?? []) {
    if (row.event_type === "dismissed" || row.event_type === "completed") {
      excluded.add(row.igdb_id);
    } else if (row.event_type === "shown") {
      const shownAt = new Date(row.created_at).getTime();
      if (now - shownAt < SHOWN_EXCLUSION_WINDOW_MS) excluded.add(row.igdb_id);
    }
  }
  return excluded;
}

/** Resolves and validates cold-start genre hints against the real genres table — invalid/nonexistent slugs are silently dropped, never erroring the whole request. */
async function resolveGenreHints(
  supabase: SupabaseClient<Database>,
  hintSlugs: string[],
): Promise<string[]> {
  if (hintSlugs.length === 0) return [];
  const { data } = await supabase
    .from("genres")
    .select("name")
    .in("slug", hintSlugs);
  return (data ?? []).map((row) => row.name);
}

async function hydrateResults(
  supabase: SupabaseClient<Database>,
  ranked: RankedCandidate[],
  profile: TasteProfile,
  genreHints: string[] | undefined,
): Promise<RecommendationResult[]> {
  if (ranked.length === 0) return [];
  const igdbIds = ranked.map((r) => r.hit.igdbId);
  const { data: gameRows } = await supabase
    .from("games")
    .select(
      "igdb_id, slug, name, cover_image_id, release_date, igdb_game_type, version_parent_igdb_id",
    )
    .in("igdb_id", igdbIds);
  const byIgdbId = new Map((gameRows ?? []).map((row) => [row.igdb_id, row]));

  return ranked.map(({ hit }) => {
    const row = byIgdbId.get(hit.igdbId);
    const base: GameSearchResult = row
      ? toSearchResult(row)
      : {
          source: "igdb",
          igdbId: hit.igdbId,
          slug: hit.slug,
          name: hit.name,
          coverImageId: hit.coverImageId,
          releaseYear: hit.releaseYear,
          gameType: null,
          versionParentIgdbId: null,
        };
    const reason = generateReason(
      [...hit.genres, ...hit.gameModes],
      profile,
      genreHints,
    );
    return { ...base, reason };
  });
}

/**
 * Full recommendation-generation flow. Order of operations, all required:
 *
 *  1. Cache check (`recommendations:${userId}:${seed}`) — a hit returns
 *     immediately, no rate-limit check, no signal/Pinecone call at all.
 *  2. Build the taste profile. Fewer than COLD_START_THRESHOLD positive
 *     signals and no genre hints -> coldStart:true, no Pinecone call.
 *     Fewer signals but valid genre hints -> a non-personalized,
 *     genre-biased query, mode:"preference-assisted". Enough signals ->
 *     normal fully personalized flow, any hints ignored.
 *  3. The recommendations rate limit — not allowed throws
 *     RecommendationsRateLimitedError before any Pinecone call.
 *  4. One bounded searchGameHits call, exclusion filtering, blended
 *     ranking, truncation to TARGET_SIZE, hydration, reason generation.
 *  5. Zero valid results, or a Pinecone error, is a genuine unavailability
 *     (RecommendationsUnavailableError / the Pinecone SDK's own errors) —
 *     never conflated with a merely-reduced (but nonzero) count, which
 *     renders normally with a notice.
 */
export async function getRecommendations(
  supabase: SupabaseClient<Database>,
  {
    userId,
    seed,
    clientId,
    genreHints,
  }: { userId: string; seed: number; clientId: string; genreHints?: string[] },
): Promise<RecommendationsOutcome> {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${seed}`;
  const cached = getCachedSearch<RecommendationResult>(cacheKey);
  if (cached) {
    return {
      results: cached,
      mode: cached[0]?.reason.startsWith("Matches your selected genre")
        ? "preference-assisted"
        : "personalized",
      reduced: cached.length > 0 && cached.length < FULL_RESULT_FLOOR,
      coldStart: false,
    };
  }

  const profile = await buildUserTasteProfile(supabase, userId);
  const resolvedHints =
    profile.positiveSignalCount < COLD_START_THRESHOLD
      ? await resolveGenreHints(supabase, genreHints ?? [])
      : [];
  const usingPreferenceAssist =
    profile.positiveSignalCount < COLD_START_THRESHOLD &&
    resolvedHints.length > 0;

  if (
    profile.positiveSignalCount < COLD_START_THRESHOLD &&
    !usingPreferenceAssist
  ) {
    return {
      results: [],
      mode: "personalized",
      reduced: false,
      coldStart: true,
    };
  }

  const rate = checkRecommendationsRateLimit(clientId);
  if (!rate.allowed) {
    throw new RecommendationsRateLimitedError();
  }

  const query = usingPreferenceAssist
    ? `Popular games in: ${resolvedHints.join(", ")}`
    : buildSyntheticQuery(profile);

  let hits: StructuredGameHit[];
  try {
    hits = await searchGameHits(query, CANDIDATE_TOPK);
  } catch (err) {
    if (err instanceof PineconeSearchError) throw err;
    throw err;
  }

  const exclusionSet = await buildExclusionSet(supabase, userId);
  const seenIgdbIds = new Set<number>();
  const eligibleHits = hits.filter((hit) => {
    if (exclusionSet.has(hit.igdbId)) return false;
    if (seenIgdbIds.has(hit.igdbId)) return false;
    seenIgdbIds.add(hit.igdbId);
    return true;
  });

  if (eligibleHits.length === 0) {
    throw new RecommendationsUnavailableError(
      "no eligible recommendation candidates after exclusion",
    );
  }

  const effectiveProfile: TasteProfile = usingPreferenceAssist
    ? {
        positiveTags: new Map(),
        negativeTags: new Map(),
        strongSignalGames: [],
        positiveSignalCount: 0,
      }
    : profile;

  const ranked = rankCandidates(
    eligibleHits,
    effectiveProfile.positiveTags,
    effectiveProfile.negativeTags,
  ).slice(0, TARGET_SIZE);

  const results = await hydrateResults(
    supabase,
    ranked,
    effectiveProfile,
    usingPreferenceAssist ? resolvedHints : undefined,
  );

  const reduced = results.length > 0 && results.length < FULL_RESULT_FLOOR;
  const mode = usingPreferenceAssist ? "preference-assisted" : "personalized";

  setCachedSearch<RecommendationResult>(cacheKey, results);

  return { results, mode, reduced, coldStart: false };
}

/**
 * Records a single `clicked` feedback row (fire-and-forget from the
 * caller's perspective — see the click-tracking design in
 * docs/RECOMMENDATIONS.md). `gameId` is resolved server-side by the
 * caller before this is invoked, never accepted directly from a client
 * request body — see src/server/actions/recommendations.ts and
 * src/app/api/recommendations/click/route.ts, neither of which accept a
 * client-supplied gameId/userId.
 */
export async function recordClick(
  supabase: SupabaseClient<Database>,
  userId: string,
  igdbId: number,
): Promise<void> {
  const { data: game } = await supabase
    .from("games")
    .select("id")
    .eq("igdb_id", igdbId)
    .maybeSingle();

  await supabase.from("recommendation_feedback").insert({
    user_id: userId,
    igdb_id: igdbId,
    game_id: game?.id ?? null,
    event_type: "clicked",
  });
}
