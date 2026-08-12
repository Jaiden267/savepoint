import { z } from "zod";
import { PINECONE_SCHEMA_VERSION } from "@/lib/pinecone/constants";

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

/** Natural-language semantic queries ("atmospheric sci-fi exploration") run longer than title searches, hence the higher cap than searchQuerySchema. */
export const semanticSearchQuerySchema = z.string().trim().min(1).max(300);

export const semanticSearchTopKSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(24)
  .default(12);

/**
 * Validates a Pinecone hit's raw metadata before it's ever rendered or
 * used for anything — a hit's `fields` is data this app previously wrote
 * to an external store, not a database row with its own schema
 * enforcement, so it must be validated the same as any other untrusted
 * external input. Only matches current-schema (v2) records with enough
 * fields to render a catalogue-only search result; a legacy v1 record (no
 * `schema_version`) or an incomplete/corrupt one fails validation and is
 * dropped by the caller rather than rendered — see
 * src/server/services/semantic-search.ts.
 */
export const pineconeCatalogueRecordSchema = z.object({
  schema_version: z.literal(PINECONE_SCHEMA_VERSION),
  igdb_id: z.number().int().positive(),
  slug: gameSlugSchema,
  name: z.string().trim().min(1),
  cover_image_id: z.string().trim().min(1).optional(),
  release_year: z.number().int().optional(),
});

/** Validates the igdb_id a catalogue-only search result's "import and open" action submits — see src/server/actions/games.ts. */
export const catalogueImportIgdbIdSchema = z.coerce.number().int().positive();

export type GameSlug = z.infer<typeof gameSlugSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SemanticSearchQuery = z.infer<typeof semanticSearchQuerySchema>;
export type PineconeCatalogueRecord = z.infer<
  typeof pineconeCatalogueRecordSchema
>;
