import "server-only";
import { ensureConfiguredIndex } from "./client.ts";

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

const RESULT_FIELDS = [
  "igdb_id",
  "schema_version",
  "slug",
  "name",
  "cover_image_id",
  "release_year",
];

/**
 * No Supabase dependency at all — returns ordered hits keyed by igdb_id.
 * The caller (src/server/services/semantic-search.ts) owns the Supabase
 * re-fetch (by igdb_id, never the Pinecone record's own top-level id,
 * which is a raw Supabase UUID on v1 records and `igdb-${igdbId}` on v2
 * ones — using it for a Supabase lookup would throw a Postgres
 * invalid-uuid error on a mixed index), using its own request-scoped
 * client, never this module.
 */
export async function searchGameIds(
  query: string,
  topK: number,
): Promise<PineconeHit[]> {
  // Propagates PineconeIndexUnavailableError as-is — the caller catches
  // that specific type to decide on a lexical fallback.
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

  const hits: PineconeHit[] = [];
  for (const hit of response.result.hits) {
    const fields = hit.fields as Record<string, unknown>;
    const igdbId = fields.igdb_id;
    if (typeof igdbId === "number") {
      hits.push({ igdbId, score: hit._score, fields });
    }
  }
  return hits;
}
