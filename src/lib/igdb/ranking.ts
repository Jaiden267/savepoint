// Deliberately NOT `server-only` — pure ranking logic, no secrets, no
// network access. scripts/igdb-smoke-test.mts (a plain Node script outside
// Next's bundler) imports this directly; see apicalypse.ts's header comment
// for why that matters.
// Explicit .ts extension — Node's native ESM resolver (used when
// scripts/igdb-smoke-test.mts imports this file directly) requires it;
// webpack/tsc resolve it fine either way.
import { normalizeGameName } from "./normalize.ts";
import type { GameSearchResult } from "./types";

/**
 * Dropped entirely, before ranking, using the real returned `game_type.type`
 * string — never a deprecated numeric where-clause. IGDB returns this field
 * as an English label ("Main Game", "Port", "Pack/Addon", ...), never
 * snake_case — confirmed live against the `game_types` reference table
 * (Prompt 7C) and passed through unmodified by mappers.ts. Comparisons
 * below lowercase both sides, so these Sets/maps must use IGDB's real
 * label text, not an assumed snake_case shape (a prior version of this
 * file used snake_case keys that never matched any real response, silently
 * making every type-based comparison fall through to the "unknown" case —
 * see the "lego star war" ranking investigation). DLC/expansion/remaster/
 * port/episode/season stay in-band; only these three are excluded outright.
 */
const EXCLUDED_GAME_TYPES = new Set(["bundle", "mod", "pack/addon"]);

/** Lower is better. Types not listed (including an unknown/future IGDB type) fall through to the same penalty as DLC-ish content. */
const TYPE_PENALTY: Record<string, number> = {
  "main game": 0,
  remake: 1,
  remaster: 1,
  port: 1,
  "expanded game": 1,
  "standalone expansion": 2,
  dlc: 3,
  expansion: 3,
  episode: 3,
  season: 3,
};
const UNKNOWN_TYPE_PENALTY = 4;

function typePenalty(gameType: string | null): number {
  if (!gameType) return UNKNOWN_TYPE_PENALTY;
  return TYPE_PENALTY[gameType.toLowerCase()] ?? UNKNOWN_TYPE_PENALTY;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 0 = exact, 1 = prefix, 2 = whole-word substring, 3 = everything else (weakest). */
function matchTier(normalizedQuery: string, normalizedName: string): number {
  if (!normalizedQuery) return 3;
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  const wordBoundary = new RegExp(
    `(^|\\s)${escapeRegExp(normalizedQuery)}(\\s|$)`,
  );
  if (wordBoundary.test(normalizedName)) return 2;
  return 3;
}

/**
 * Drops obviously-unwanted result types (bundle/mod/pack) using real
 * returned data. Applied once, before ranking, to both raw IGDB results and
 * (redundantly-safely) the merged local+IGDB set.
 */
export function excludeUnwantedGameTypes<T extends { gameType: string | null }>(
  results: T[],
): T[] {
  return results.filter(
    (result) =>
      !result.gameType ||
      !EXCLUDED_GAME_TYPES.has(result.gameType.toLowerCase()),
  );
}

/**
 * Ranks search results so exact/prefix/whole-word matches outrank IGDB's own
 * fuzzy ordering, editions/versions rank below their canonical game, and
 * DLC/expansion-type entries rank below main games — without excluding them
 * outright (only bundle/mod/pack are excluded, separately, before this
 * runs). Stable: ties preserve input order. Used identically for raw IGDB
 * results and the merged local+IGDB set (see game-catalogue.ts), so a weak
 * match from either source can never outrank a strong match from the other.
 */
export function rankSearchResults<T extends GameSearchResult>(
  query: string,
  results: T[],
): T[] {
  const normalizedQuery = normalizeGameName(query);
  return results
    .map((result, index) => ({ result, index }))
    .sort((a, b) => {
      const tierA = matchTier(
        normalizedQuery,
        normalizeGameName(a.result.name),
      );
      const tierB = matchTier(
        normalizedQuery,
        normalizeGameName(b.result.name),
      );
      if (tierA !== tierB) return tierA - tierB;

      const versionA = a.result.versionParentIgdbId !== null ? 1 : 0;
      const versionB = b.result.versionParentIgdbId !== null ? 1 : 0;
      if (versionA !== versionB) return versionA - versionB;

      const penaltyA = typePenalty(a.result.gameType);
      const penaltyB = typePenalty(b.result.gameType);
      if (penaltyA !== penaltyB) return penaltyA - penaltyB;

      return a.index - b.index;
    })
    .map(({ result }) => result);
}
