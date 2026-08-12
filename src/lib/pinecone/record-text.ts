import { MAX_TEXT_CHARS } from "./constants.ts";

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

export interface GameRecordFieldsInput {
  gameId: string;
  igdbId: number;
  slug: string;
  name: string;
  releaseDate: string | null;
  genres: NamedRef[];
  platforms: NamedRef[];
  coverImageId: string | null;
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
    game_id: input.gameId,
    igdb_id: input.igdbId,
    slug: input.slug,
    name: input.name,
    genres: input.genres.slice(0, MAX_METADATA_REFS).map((g) => g.name),
    platforms: input.platforms.slice(0, MAX_METADATA_REFS).map((p) => p.name),
  };

  if (input.releaseDate) {
    fields.release_year = new Date(input.releaseDate).getUTCFullYear();
  }
  if (input.coverImageId) {
    fields.cover_image_id = input.coverImageId;
  }

  return fields;
}
