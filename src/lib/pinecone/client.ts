import "server-only";

/**
 * Pinecone integration placeholder.
 *
 * Not implemented yet — index bootstrap (integrated model
 * `llama-text-embed-v2`, index `savepoint-games`, namespace `games`),
 * on-demand upsert and semantic search/recommendations land in the Pinecone
 * milestone (see docs/ROADMAP.md). Calling these functions before then fails
 * loudly instead of returning fake data or a silent no-op. Server-only: never
 * import this from a Client Component.
 */

export class PineconeNotImplementedError extends Error {
  constructor(operation: string) {
    super(
      `Pinecone integration is not implemented yet (attempted: ${operation}). ` +
        "This is wired up in the Pinecone milestone.",
    );
    this.name = "PineconeNotImplementedError";
  }
}

/** Returns a handle to the `savepoint-games` index, verifying compatibility. */
export async function getGamesIndex(): Promise<never> {
  throw new PineconeNotImplementedError("getGamesIndex");
}

/** Runs a semantic search against the `games` namespace. */
export async function searchGames(query: string): Promise<never> {
  throw new PineconeNotImplementedError(`searchGames("${query}")`);
}
