import "server-only";
import type { TablesInsert } from "@/types/database";

/**
 * Raw shapes as returned by IGDB's v4 API — only the fields this app
 * requests (see apicalypse.ts's field lists), not IGDB's full schema.
 * `game_type`/`websites.type` use IGDB's current reference-table fields,
 * never the deprecated `category`/`websites.category` numeric enums.
 */

export interface IgdbGameTypeRaw {
  id: number;
  type: string;
}

export interface IgdbWebsiteTypeRaw {
  id: number;
  type: string;
}

export interface IgdbWebsiteRaw {
  url: string;
  type?: IgdbWebsiteTypeRaw | null;
}

export interface IgdbImageRaw {
  image_id: string;
}

export interface IgdbGenreRaw {
  id: number;
  name: string;
  slug: string;
}

export interface IgdbPlatformRaw {
  id: number;
  name: string;
  slug: string;
}

export interface IgdbGameModeRaw {
  id: number;
  name: string;
  slug: string;
}

export interface IgdbThemeRaw {
  id: number;
  name: string;
  slug: string;
}

export interface IgdbKeywordRaw {
  id: number;
  name: string;
}

export interface IgdbCompanyRaw {
  name: string;
}

export interface IgdbInvolvedCompanyRaw {
  company?: IgdbCompanyRaw | null;
  developer?: boolean;
  publisher?: boolean;
}

/** Raw shape for a search-result row (lighter field set than full detail). */
export interface IgdbGameSearchRaw {
  id: number;
  name: string;
  slug: string;
  cover?: IgdbImageRaw | null;
  game_type?: IgdbGameTypeRaw | null;
  version_parent?: number | null;
  first_release_date?: number | null;
}

/** Raw shape for a full game-detail row. */
export interface IgdbGameDetailRaw {
  id: number;
  name: string;
  slug: string;
  summary?: string | null;
  storyline?: string | null;
  first_release_date?: number | null;
  cover?: IgdbImageRaw | null;
  screenshots?: IgdbImageRaw[] | null;
  artworks?: IgdbImageRaw[] | null;
  genres?: IgdbGenreRaw[] | null;
  platforms?: IgdbPlatformRaw[] | null;
  game_modes?: IgdbGameModeRaw[] | null;
  themes?: IgdbThemeRaw[] | null;
  keywords?: IgdbKeywordRaw[] | null;
  involved_companies?: IgdbInvolvedCompanyRaw[] | null;
  rating?: number | null;
  rating_count?: number | null;
  aggregated_rating?: number | null;
  aggregated_rating_count?: number | null;
  websites?: IgdbWebsiteRaw[] | null;
  game_type?: IgdbGameTypeRaw | null;
  version_parent?: number | null;
}

/**
 * Unified shape for both a local (cached) game row and an IGDB-only search
 * result, so `ranking.ts` can rank a merged set with one algorithm and
 * `game-catalogue.ts` can dedupe by `igdbId`. `slug` is the internal slug
 * for local rows and IGDB's own slug for igdb-only rows.
 */
export interface GameSearchResult {
  source: "local" | "igdb";
  igdbId: number;
  slug: string;
  name: string;
  coverImageId: string | null;
  releaseYear: number | null;
  gameType: string | null;
  versionParentIgdbId: number | null;
}

/**
 * Fully normalized, DB-ready result of mapping one raw IGDB game-detail
 * response — the single shape produced by `mappers.ts` and consumed by
 * `game-sync.ts`'s `upsertGameFromIgdbDetail`. Fetching + mapping happens
 * exactly once per import (see `detail.ts`), never twice.
 */
export interface IgdbGameDetail {
  game: Omit<TablesInsert<"games">, "id" | "created_at" | "updated_at">;
  genres: TablesInsert<"genres">[];
  platforms: TablesInsert<"platforms">[];
  gameModes: TablesInsert<"game_modes">[];
  themes: TablesInsert<"themes">[];
}
