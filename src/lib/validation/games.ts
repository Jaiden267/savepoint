import { z } from "zod";

/**
 * Matches IGDB's own slug shape (lowercase alnum segments joined by single
 * hyphens). Validated before any local/IGDB lookup so an obviously-invalid
 * `/games/[slug]` request 404s immediately with zero DB or IGDB calls —
 * part of the abuse boundary documented in game-sync.ts.
 */
export const gameSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Shared by /api/search and the /search page — caps length so a query can't be used to abuse local ILIKE or the IGDB search wrapper. */
export const searchQuerySchema = z.string().trim().min(1).max(100);

export type GameSlug = z.infer<typeof gameSlugSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
