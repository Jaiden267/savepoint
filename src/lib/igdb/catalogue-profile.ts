// Deliberately NOT `server-only` — pure filter/predicate construction, no
// secrets, no network access. scripts/igdb-catalogue-estimate.mts and
// scripts/igdb-catalogue-sync.mts (plain Node scripts outside Next's
// bundler) import this directly; see apicalypse.ts's header comment for
// why that matters.
//
// Two representations of the SAME profile definition are exported, kept in
// sync by construction (both read from CATALOGUE_PROFILES) rather than by
// convention:
//   - buildCatalogueWhereClause / buildReleaseCheckWhereClause: server-side
//     Apicalypse `where` clauses using resolved numeric game_type ids (the
//     proven, live-verified filter shape — see docs/PINECONE.md's Gate B
//     numbers). Used by `discover` and `release-check`, which can afford a
//     server-side filter because they walk a bounded, already-eligible set.
//   - isEligibleForCatalogue: a client-side predicate using the *string*
//     game_type.type IGDB already returns on every scan row (no id
//     resolution needed at evaluation time). Used by `incremental`, which
//     deliberately does NOT filter server-side (see the module doc in
//     igdb-catalogue-sync.mts for why — it needs to see games regardless of
//     prior eligibility, to catch ones that just became eligible).
//
// Game-type ids are never hardcoded from memory anywhere in this module —
// every id-based filter is built from a `GameTypeRef[]` the caller fetched
// live from IGDB's own `game_types` endpoint moments earlier.

export type CatalogueProfileName = "conservative" | "balanced" | "broad";

export interface GameTypeRef {
  id: number;
  type: string;
}

interface ProfileDefinition {
  /** "include" = game_type must be one of typeNames; "exclude" = must not be. */
  mode: "include" | "exclude";
  /** Matched case-insensitively against game_types.type (IGDB's own Title Case strings, e.g. "Main Game"). */
  typeNames: string[];
}

/**
 * Live-confirmed (2026-08-12, see docs/PINECONE.md's Gate B numbers)
 * candidate counts, all filtered additionally by first_release_date <= now,
 * cover != null, (summary != null | storyline != null), and
 * total_rating_count >= 1 — the "real engagement" filter that separates a
 * useful catalogue from IGDB's enormous long tail of zero-rating hobby
 * entries (see the plan's §2 for the raw-vs-rated counts).
 */
export const CATALOGUE_PROFILES: Record<
  CatalogueProfileName,
  ProfileDefinition
> = {
  conservative: {
    mode: "include",
    typeNames: ["Main Game"],
  },
  balanced: {
    mode: "include",
    typeNames: ["Main Game", "Remake", "Remaster", "Expanded Game"],
  },
  broad: {
    mode: "exclude",
    typeNames: ["Bundle", "Mod", "Fork", "Pack / Addon"],
  },
};

/** Fields this module needs from a CATALOGUE_SCAN_FIELDS-shaped IGDB scan row. */
export interface CatalogueScanCandidate {
  id: number;
  gameType: string | null;
  firstReleaseDateUnix: number | null;
  coverImageId: string | null;
  summary: string | null;
  storyline: string | null;
  totalRatingCount: number | null;
  updatedAtUnix: number | null;
}

/** Resolves a profile's configured type names to live-fetched numeric ids — never hardcoded, always looked up against the caller's own game_types response. */
export function resolveProfileTypeIds(
  profile: CatalogueProfileName,
  gameTypes: GameTypeRef[],
): number[] {
  const wanted = new Set(
    CATALOGUE_PROFILES[profile].typeNames.map((name) => name.toLowerCase()),
  );
  return gameTypes
    .filter((gt) => wanted.has(gt.type.toLowerCase()))
    .map((gt) => gt.id);
}

function typeClause(
  profile: CatalogueProfileName,
  gameTypes: GameTypeRef[],
): string {
  const def = CATALOGUE_PROFILES[profile];
  const ids = resolveProfileTypeIds(profile, gameTypes);
  const op = def.mode === "include" ? "=" : "!=";
  return `game_type ${op} (${ids.join(",")})`;
}

/**
 * Server-side `where` clause for `discover`'s id-ordered, profile-filtered
 * full sweep. `afterIgdbId` is the resumable cursor position (omit for the
 * very first page of a generation).
 */
export function buildCatalogueWhereClause(opts: {
  profile: CatalogueProfileName;
  gameTypes: GameTypeRef[];
  nowUnixSeconds: number;
  afterIgdbId?: number;
}): string {
  const clauses = [
    typeClause(opts.profile, opts.gameTypes),
    "first_release_date != null",
    `first_release_date <= ${opts.nowUnixSeconds}`,
    "cover != null",
    "(summary != null | storyline != null)",
    "total_rating_count >= 1",
  ];
  if (opts.afterIgdbId !== undefined) {
    clauses.push(`id > ${opts.afterIgdbId}`);
  }
  return clauses.join(" & ");
}

/**
 * Server-side `where` clause for `release-check`'s tie-safe
 * `(first_release_date, id)` watermark scan. The compound OR watermark
 * condition is fully parenthesized as one unit *before* being combined
 * with any other filter via `&` — required so Apicalypse's operator
 * precedence can't silently rebind the OR across the AND boundary.
 */
export function buildReleaseCheckWhereClause(opts: {
  profile: CatalogueProfileName;
  gameTypes: GameTypeRef[];
  afterReleaseDateUnix: number;
  tieBreakIgdbId: number;
  nowUnixSeconds: number;
}): string {
  const watermarkClause = `((first_release_date > ${opts.afterReleaseDateUnix}) | (first_release_date = ${opts.afterReleaseDateUnix} & id > ${opts.tieBreakIgdbId}))`;
  return [
    watermarkClause,
    `first_release_date <= ${opts.nowUnixSeconds}`,
    "cover != null",
    "(summary != null | storyline != null)",
    "total_rating_count >= 1",
    typeClause(opts.profile, opts.gameTypes),
  ].join(" & ");
}

/**
 * Server-side `where` clause for `incremental`'s tie-safe
 * `(updated_at, id)` watermark scan — deliberately carries none of the
 * profile's other filters, since incremental's whole purpose is to notice
 * games whose eligibility just changed (see isEligibleForCatalogue below,
 * applied client-side to whatever this returns).
 */
export function buildIncrementalWhereClause(opts: {
  afterUpdatedAtUnix: number;
  tieBreakIgdbId: number;
}): string {
  return `((updated_at > ${opts.afterUpdatedAtUnix}) | (updated_at = ${opts.afterUpdatedAtUnix} & id > ${opts.tieBreakIgdbId}))`;
}

/**
 * Client-side eligibility predicate — string-based (no id resolution
 * needed), applied per-row after a fetch. Mirrors the server-side `where`
 * clauses' logic exactly; kept in a unit test asserting agreement between
 * both representations on a shared fixture set, since they're two
 * independently-evaluated expressions of the same CATALOGUE_PROFILES
 * definition and must never silently drift apart.
 */
export function isEligibleForCatalogue(
  candidate: CatalogueScanCandidate,
  profile: CatalogueProfileName,
  nowUnixSeconds: number,
): boolean {
  const def = CATALOGUE_PROFILES[profile];
  const type = candidate.gameType?.toLowerCase() ?? null;
  const wanted = new Set(def.typeNames.map((name) => name.toLowerCase()));
  const typeOk =
    type !== null &&
    (def.mode === "include" ? wanted.has(type) : !wanted.has(type));

  return (
    typeOk &&
    candidate.firstReleaseDateUnix !== null &&
    candidate.firstReleaseDateUnix <= nowUnixSeconds &&
    candidate.coverImageId !== null &&
    (Boolean(candidate.summary) || Boolean(candidate.storyline)) &&
    (candidate.totalRatingCount ?? 0) >= 1
  );
}
