import "server-only";
import { ensureConfiguredIndex } from "./client.ts";

export class PineconeSearchError extends Error {
  constructor(cause?: unknown) {
    super("Pinecone search request failed.");
    this.name = "PineconeSearchError";
    this.cause = cause instanceof Error ? cause : undefined;
  }
}

export interface PineconeHit {
  gameId: string;
  score: number;
}

/**
 * No Supabase dependency at all — returns ordered game ids only. The
 * caller (src/server/services/semantic-search.ts) owns the Supabase
 * re-fetch, using its own request-scoped client, never this module.
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
      fields: ["game_id"],
    });
  } catch (err) {
    throw new PineconeSearchError(err);
  }

  const hits: PineconeHit[] = [];
  for (const hit of response.result.hits) {
    const gameId = (hit.fields as Record<string, unknown>).game_id;
    if (typeof gameId === "string") {
      hits.push({ gameId, score: hit._score });
    }
  }
  return hits;
}
