import { MAX_TEXT_CHARS, PINECONE_SCHEMA_VERSION } from "./constants.ts";

interface NamedRef {
  name: string;
}

/**
 * `keywords` is the real `games.keywords` column (text[], capped 10,
 * populated by src/lib/igdb/mappers.ts from IGDB's own keyword list) — not
 * invented data. Callers select it as part of the ordinary game-row query.
 */
export interface GameEmbeddingInput {
  name: string;
  summary: string | null;
  storyline: string | null;
  keywords: string[];
  genres: NamedRef[];
  platforms: NamedRef[];
  gameModes: NamedRef[];
  themes: NamedRef[];
}

function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trimEnd();
}

function listSegment(label: string, names: string[]): string | null {
  return names.length > 0 ? `${label}: ${names.join(", ")}.` : null;
}

/** Composes the text embedded by Pinecone's integrated inference for a game. */
export function buildGameEmbeddingText(input: GameEmbeddingInput): string {
  const parts: string[] = [input.name];

  const description = [input.summary, input.storyline]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
  if (description) parts.push(description);

  const segments = [
    listSegment(
      "Genres",
      input.genres.map((g) => g.name),
    ),
    listSegment(
      "Platforms",
      input.platforms.map((p) => p.name),
    ),
    listSegment(
      "Modes",
      input.gameModes.map((m) => m.name),
    ),
    listSegment(
      "Themes",
      input.themes.map((t) => t.name),
    ),
    listSegment("Keywords", input.keywords),
  ].filter((segment): segment is string => segment !== null);

  parts.push(...segments);

  return truncateAtWordBoundary(parts.join(" "), MAX_TEXT_CHARS);
}

const MAX_METADATA_REFS = 5;

/**
 * v2 schema (Prompt 7C) — `game_id` (the raw Supabase UUID) is dropped:
 * once semantic-search hydration resolves by `igdb_id` instead of `id`
 * (see src/server/services/semantic-search.ts), there's no remaining
 * reader of a UUID metadata field, and keeping it around would just be
 * one more thing that can't be trusted to be a real UUID across schema
 * versions. `schema_version` lets a legacy (absent-field) v1 record be
 * told apart from one written under this shape — see
 * src/lib/pinecone/sync.ts's schema_version-aware skip condition.
 */
export interface GameRecordFieldsInput {
  igdbId: number;
  slug: string;
  name: string;
  releaseDate: string | null;
  genres: NamedRef[];
  platforms: NamedRef[];
  gameModes: NamedRef[];
  coverImageId: string | null;
  /** Unix seconds — IGDB's own `updated_at`, used by incremental discovery's watermark comparisons. Omitted if unavailable. */
  igdbUpdatedAtUnix: number | null;
}

/**
 * Pinecone record metadata values can't be `null` (RecordMetadataValue is
 * string | boolean | number | string[]) — nullable inputs are omitted from
 * the field set entirely rather than coerced to a sentinel value.
 */
export type GameVectorFields = Record<
  string,
  string | number | boolean | string[]
>;

export function buildGameRecordFields(
  input: GameRecordFieldsInput,
): GameVectorFields {
  const fields: GameVectorFields = {
    schema_version: PINECONE_SCHEMA_VERSION,
    igdb_id: input.igdbId,
    slug: input.slug,
    name: input.name,
    genres: input.genres.slice(0, MAX_METADATA_REFS).map((g) => g.name),
    platforms: input.platforms.slice(0, MAX_METADATA_REFS).map((p) => p.name),
  };

  if (input.gameModes.length > 0) {
    fields.game_modes = input.gameModes
      .slice(0, MAX_METADATA_REFS)
      .map((m) => m.name);
  }
  if (input.releaseDate) {
    fields.release_year = new Date(input.releaseDate).getUTCFullYear();
  }
  if (input.coverImageId) {
    fields.cover_image_id = input.coverImageId;
  }
  if (input.igdbUpdatedAtUnix !== null) {
    fields.igdb_updated_at = input.igdbUpdatedAtUnix;
  }

  return fields;
}
