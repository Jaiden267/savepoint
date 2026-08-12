/**
 * Deliberately NOT `server-only`: this is pure string construction with no
 * secrets and no network access, and scripts/igdb-smoke-test.mts (a plain
 * Node script, outside Next's bundler) needs to import it directly — the
 * real `server-only` package throws unconditionally outside Next's own
 * module resolution, which is exactly why scripts/verify-schema.mts never
 * imports src/lib/supabase/* either. Everything that actually touches
 * IGDB_CLIENT_ID/IGDB_CLIENT_SECRET or makes a network call (token.ts,
 * client.ts, search.ts, detail.ts) stays `server-only`.
 *
 * The only place an Apicalypse query string is built anywhere in this app —
 * every field list here is fixed; the only interpolated values are a
 * validated search string, a validated slug, or a numeric id/limit. Nothing
 * else ever constructs or accepts a free-form Apicalypse body, satisfying
 * "no arbitrary Apicalypse query bodies to users."
 */

const SEARCH_FIELDS = [
  "id",
  "name",
  "slug",
  "cover.image_id",
  "game_type.id",
  "game_type.type",
  "version_parent",
  "first_release_date",
].join(",");

const DETAIL_FIELDS = [
  "id",
  "name",
  "slug",
  "summary",
  "storyline",
  "first_release_date",
  "cover.image_id",
  "screenshots.image_id",
  "artworks.image_id",
  "genres.id",
  "genres.name",
  "genres.slug",
  "platforms.id",
  "platforms.name",
  "platforms.slug",
  "game_modes.id",
  "game_modes.name",
  "game_modes.slug",
  "themes.id",
  "themes.name",
  "themes.slug",
  "keywords.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "rating",
  "rating_count",
  "aggregated_rating",
  "aggregated_rating_count",
  "websites.url",
  "websites.type.type",
  "game_type.id",
  "game_type.type",
  "version_parent",
  "updated_at",
].join(",");

/**
 * Lightweight field set for catalogue discovery/incremental/release-check
 * scans (Prompt 7C) — deliberately NOT the full DETAIL_FIELDS list, since a
 * scan page can cover up to 500 rows and only needs enough to evaluate
 * eligibility (see src/lib/igdb/catalogue-profile.ts) and populate the
 * ledger. `updated_at` and `total_rating_count` are the two fields this
 * list adds beyond what SEARCH_FIELDS already has — the former drives
 * incremental's watermark, the latter drives the "has real engagement"
 * eligibility filter. Full content fields (summary/genres/platforms/etc.,
 * needed to actually build a Pinecone record) are fetched separately, in
 * batches, only for candidates about to be synced — see buildCatalogueDetailBatchQuery.
 */
const CATALOGUE_SCAN_FIELDS = [
  "id",
  "game_type.id",
  "game_type.type",
  "first_release_date",
  "cover.image_id",
  "summary",
  "storyline",
  "total_rating_count",
  "updated_at",
].join(",");

/** Over-fetch margin so app-side type filtering (ranking.ts) rarely needs a second round-trip after dropping bundle/mod/pack results. */
const SEARCH_OVERFETCH_MARGIN = 10;
const SEARCH_OVERFETCH_CAP = 50;

/** IGDB's own page-size ceiling for a single list request. */
export const CATALOGUE_SCAN_PAGE_LIMIT = 500;

/** Conservative batch size for fetching full DETAIL_FIELDS for many ids in one request — comfortably under IGDB's own limits, keeping response payload size reasonable. */
export const CATALOGUE_DETAIL_BATCH_LIMIT = 200;

/** Escapes a value for safe interpolation inside an Apicalypse double-quoted string literal. */
function escapeApicalypseString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Builds a bounded IGDB search query. `version_parent = null` excludes
 * editions/versions server-side (a plain scalar field, not deprecated).
 * Type-based exclusion (bundle/mod/pack) happens app-side against the
 * returned `game_type.type` — see ranking.ts — because that field is only
 * available as resolved data, not filterable via a stable numeric enum
 * anymore.
 */
export function buildSearchQuery(query: string, limit: number): string {
  const safeQuery = escapeApicalypseString(query);
  const overfetchLimit = Math.min(
    limit + SEARCH_OVERFETCH_MARGIN,
    SEARCH_OVERFETCH_CAP,
  );
  return [
    `search "${safeQuery}";`,
    `fields ${SEARCH_FIELDS};`,
    `where version_parent = null;`,
    `limit ${overfetchLimit};`,
  ].join("\n");
}

/** Builds a fixed, single-game detail query by IGDB id. */
export function buildDetailQuery(igdbId: number): string {
  return [`fields ${DETAIL_FIELDS};`, `where id = ${igdbId};`, `limit 1;`].join(
    "\n",
  );
}

/** Builds a fixed, single-game detail query by IGDB slug. */
export function buildDetailBySlugQuery(slug: string): string {
  const safeSlug = escapeApicalypseString(slug);
  return [
    `fields ${DETAIL_FIELDS};`,
    `where slug = "${safeSlug}";`,
    `limit 1;`,
  ].join("\n");
}

/**
 * Builds a paged catalogue-scan query (discover/incremental/release-check).
 * `whereClause` is never user input — it's always built by
 * src/lib/igdb/catalogue-profile.ts from fixed templates with only
 * validated numeric ids/timestamps interpolated, the same trust boundary
 * `buildSearchQuery`'s validated search string already relies on. Kept as a
 * separate builder (not folded into buildSearchQuery) because catalogue
 * scans use a different field set, no `search` keyword, and an explicit
 * `sort` clause the text-search path doesn't need.
 */
export function buildCatalogueScanQuery(opts: {
  whereClause: string;
  sort: string;
  limit: number;
}): string {
  return [
    `fields ${CATALOGUE_SCAN_FIELDS};`,
    `where ${opts.whereClause};`,
    `sort ${opts.sort};`,
    `limit ${opts.limit};`,
  ].join("\n");
}

/**
 * Builds a bounded count query against `whereClause` (same trust boundary
 * as buildCatalogueScanQuery) for the Gate B catalogue estimator — IGDB's
 * `/count` endpoint takes a bare `where` body, no `fields`/`sort`/`limit`.
 */
export function buildCatalogueCountQuery(whereClause: string): string {
  return whereClause ? `where ${whereClause};` : "";
}

/**
 * Builds a batched full-detail query for up to CATALOGUE_DETAIL_BATCH_LIMIT
 * ids at once — used by the `sync` step to fetch everything needed to build
 * a Pinecone record (summary/genres/platforms/etc.) for candidates that
 * mostly have no Supabase row yet, reusing the exact same DETAIL_FIELDS/
 * mapIgdbGameToRow path the on-demand import already trusts.
 */
export function buildCatalogueDetailBatchQuery(igdbIds: number[]): string {
  const idList = igdbIds.join(",");
  return [
    `fields ${DETAIL_FIELDS};`,
    `where id = (${idList});`,
    `limit ${igdbIds.length};`,
  ].join("\n");
}
