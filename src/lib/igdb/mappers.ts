// Deliberately NOT `server-only` — pure mapping/validation logic, no
// secrets, no network access. scripts/igdb-smoke-test.mts (a plain Node
// script outside Next's bundler) imports this directly; see apicalypse.ts's
// header comment for why that matters.
import type {
  GameSearchResult,
  IgdbGameDetail,
  IgdbGameDetailRaw,
  IgdbGameSearchRaw,
} from "./types";

// Explicit .ts extension (unlike this project's usual extensionless
// internal imports): Node's native ESM resolver, used when
// scripts/igdb-smoke-test.mts imports this file directly, requires it —
// webpack/tsc resolve it fine either way.
export { igdbImageUrl, type IgdbImageSize } from "./image-url.ts";

const KEYWORD_CAP = 10;
const COMPANY_NAME_CAP = 10;
const WEBSITE_CAP = 8;
const IMAGE_ID_CAP = 8;

/**
 * Only these resolved website_types.type strings are kept — everything else
 * (app-store/social/video links) is dropped at mapping time, before ever
 * reaching the `websites` jsonb column. Matched case-insensitively.
 */
const ALLOWED_WEBSITE_TYPES = new Set([
  "official",
  "steam",
  "gog",
  "epicgames",
  "wikipedia",
  "twitter",
  "x",
]);

function unixToIsoDate(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds === null || unixSeconds === undefined) return null;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Keeps a URL only if it parses as http(s) — defense against a malformed or
 * hostile upstream value ever being persisted as a clickable link. Applied
 * again, defensively, at render time in game-metadata.tsx.
 */
function safeHttpUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Maps one raw IGDB game-detail response into DB-ready rows. All
 * capping/allow-listing (keywords, company names, websites, image ids)
 * happens here, once — this is the single normalization boundary between
 * "whatever IGDB returned" and "what this app actually stores."
 */
export function mapIgdbGameToRow(raw: IgdbGameDetailRaw): IgdbGameDetail {
  const genres = (raw.genres ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    slug: g.slug,
  }));
  const platforms = (raw.platforms ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
  }));
  const gameModes = (raw.game_modes ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
  }));
  const themes = (raw.themes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
  }));

  const keywords = (raw.keywords ?? [])
    .map((k) => k.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, KEYWORD_CAP);

  const involvedCompanies = raw.involved_companies ?? [];
  const developerNames = involvedCompanies
    .filter((c) => c.developer && c.company?.name)
    .map((c) => c.company!.name)
    .slice(0, COMPANY_NAME_CAP);
  const publisherNames = involvedCompanies
    .filter((c) => c.publisher && c.company?.name)
    .map((c) => c.company!.name)
    .slice(0, COMPANY_NAME_CAP);

  const websites = (raw.websites ?? [])
    .map((w) => {
      const type = w.type?.type?.toLowerCase() ?? null;
      const url = safeHttpUrl(w.url);
      if (!type || !url || !ALLOWED_WEBSITE_TYPES.has(type)) return null;
      return { type, url };
    })
    .filter((w): w is { type: string; url: string } => w !== null)
    .slice(0, WEBSITE_CAP);

  return {
    game: {
      igdb_id: raw.id,
      name: raw.name,
      slug: raw.slug,
      summary: raw.summary ?? null,
      storyline: raw.storyline ?? null,
      release_date: unixToIsoDate(raw.first_release_date),
      cover_image_id: raw.cover?.image_id ?? null,
      screenshot_image_ids: (raw.screenshots ?? [])
        .map((s) => s.image_id)
        .slice(0, IMAGE_ID_CAP),
      artwork_image_ids: (raw.artworks ?? [])
        .map((a) => a.image_id)
        .slice(0, IMAGE_ID_CAP),
      igdb_rating: raw.rating ?? null,
      igdb_rating_count: raw.rating_count ?? null,
      igdb_aggregated_rating: raw.aggregated_rating ?? null,
      igdb_aggregated_rating_count: raw.aggregated_rating_count ?? null,
      igdb_synced_at: new Date().toISOString(),
      igdb_game_type_id: raw.game_type?.id ?? null,
      igdb_game_type: raw.game_type?.type ?? null,
      version_parent_igdb_id: raw.version_parent ?? null,
      keywords,
      developer_names: developerNames,
      publisher_names: publisherNames,
      websites,
    },
    genres,
    platforms,
    gameModes,
    themes,
  };
}

function unixToYear(unixSeconds: number | null | undefined): number | null {
  if (unixSeconds === null || unixSeconds === undefined) return null;
  return new Date(unixSeconds * 1000).getUTCFullYear();
}

/** Maps a raw IGDB search-result row into the unified search-result shape. */
export function mapIgdbSearchResult(raw: IgdbGameSearchRaw): GameSearchResult {
  return {
    source: "igdb",
    igdbId: raw.id,
    slug: raw.slug,
    name: raw.name,
    coverImageId: raw.cover?.image_id ?? null,
    releaseYear: unixToYear(raw.first_release_date),
    gameType: raw.game_type?.type ?? null,
    versionParentIgdbId: raw.version_parent ?? null,
  };
}
