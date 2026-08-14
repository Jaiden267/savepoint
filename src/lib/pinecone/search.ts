import "server-only";
import { ensureConfiguredIndex } from "./client.ts";
import { buildCatalogueRecordId } from "./constants.ts";

export class PineconeSearchError extends Error {
  constructor(cause?: unknown) {
    super("Pinecone search request failed.");
    this.name = "PineconeSearchError";
    this.cause = cause instanceof Error ? cause : undefined;
  }
}

/**
 * `igdbId` — not `gameId`/a Supabase UUID — is the identifier callers key
 * on. `igdb_id` is a plain number present on every record regardless of
 * schema version (v1 records already carried it; see docs/PINECONE.md's
 * schema-v2 section), which is what makes this module correct for a mixed
 * v1/v2 index without needing to know which shape a given hit came from.
 * `fields` carries the hit's full raw metadata (unvalidated) so the caller
 * can render a catalogue-only result straight from it when there's no
 * matching Supabase row — see src/server/services/semantic-search.ts,
 * which validates this via pineconeCatalogueRecordSchema before using it
 * for anything.
 */
export interface PineconeHit {
  igdbId: number;
  score: number;
  fields: Record<string, unknown>;
}

/**
 * Richer, typed shape of a search hit — adds the canonical record id and
 * genre/platform/game-mode tags (needed by src/server/services/recommendations.ts
 * for ranking and reason generation) on top of everything PineconeHit
 * already carries.
 */
export interface StructuredGameHit {
  recordId: string;
  igdbId: number;
  score: number;
  slug: string;
  name: string;
  coverImageId: string | null;
  releaseYear: number | null;
  genres: string[];
  platforms: string[];
  gameModes: string[];
}

const RESULT_FIELDS = [
  "igdb_id",
  "schema_version",
  "slug",
  "name",
  "cover_image_id",
  "release_year",
  "genres",
  "platforms",
  "game_modes",
];

interface RawHit {
  igdbId: number;
  score: number;
  fields: Record<string, unknown>;
}

/**
 * The one real Pinecone query call, shared by both public exports below so
 * there is exactly one query implementation, not two that could drift.
 * Filters only on `igdb_id` being a number — the same, sole condition the
 * original (pre-recommendations) searchGameIds always used — so
 * searchGameIds's behavior below is untouched byte-for-byte regardless of
 * what searchGameHits additionally requires for its own richer shape.
 */
async function queryRawHits(query: string, topK: number): Promise<RawHit[]> {
  const namespace = await ensureConfiguredIndex();

  let response;
  try {
    response = await namespace.searchRecords({
      query: { inputs: { text: query }, topK },
      fields: RESULT_FIELDS,
    });
  } catch (err) {
    throw new PineconeSearchError(err);
  }

  const hits: RawHit[] = [];
  for (const hit of response.result.hits) {
    const fields = hit.fields as Record<string, unknown>;
    const igdbId = fields.igdb_id;
    if (typeof igdbId === "number") {
      hits.push({ igdbId, score: hit._score, fields });
    }
  }
  return hits;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * No Supabase dependency at all — returns ordered hits keyed by igdb_id.
 * The caller (src/server/services/semantic-search.ts) owns the Supabase
 * re-fetch (by igdb_id, never the Pinecone record's own top-level id,
 * which is a raw Supabase UUID on v1 records and `igdb-${igdbId}` on v2
 * ones — using it for a Supabase lookup would throw a Postgres
 * invalid-uuid error on a mixed index), using its own request-scoped
 * client, never this module. `fields` is the hit's complete raw metadata,
 * unmodified — semantic-search.ts's pineconeCatalogueRecordSchema
 * validation (which requires schema_version, among others) depends on
 * that being the real, complete field set, not a reconstructed subset.
 */
export async function searchGameIds(
  query: string,
  topK: number,
): Promise<PineconeHit[]> {
  const rawHits = await queryRawHits(query, topK);
  return rawHits.map((hit) => ({
    igdbId: hit.igdbId,
    score: hit.score,
    fields: hit.fields,
  }));
}

/**
 * Richer, typed search used by src/server/services/recommendations.ts —
 * additionally requires `slug`/`name` (always written by
 * buildGameRecordFields, but defensively checked here too) and surfaces
 * genres/platforms/game_modes as plain string arrays for ranking/reason
 * generation. A hit missing igdb_id/slug/name is dropped rather than
 * rendered with placeholder text.
 */
export async function searchGameHits(
  query: string,
  topK: number,
): Promise<StructuredGameHit[]> {
  const rawHits = await queryRawHits(query, topK);

  const hits: StructuredGameHit[] = [];
  for (const hit of rawHits) {
    const { fields } = hit;
    const slug = fields.slug;
    const name = fields.name;
    if (typeof slug !== "string" || typeof name !== "string") continue;

    hits.push({
      recordId: buildCatalogueRecordId(hit.igdbId),
      igdbId: hit.igdbId,
      score: hit.score,
      slug,
      name,
      coverImageId:
        typeof fields.cover_image_id === "string"
          ? fields.cover_image_id
          : null,
      releaseYear:
        typeof fields.release_year === "number" ? fields.release_year : null,
      genres: stringArray(fields.genres),
      platforms: stringArray(fields.platforms),
      gameModes: stringArray(fields.game_modes),
    });
  }
  return hits;
}
