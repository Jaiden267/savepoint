import "server-only";
import { Pinecone, Errors } from "@pinecone-database/pinecone";
import type { Index } from "@pinecone-database/pinecone";
import { serverEnv } from "@/lib/env.server";
import { PINECONE_NAMESPACE } from "./constants.ts";
import { isIndexCompatible, describeIncompatibility } from "./index-compat.ts";
import type { GameVectorFields } from "./record-text.ts";

/** Base type for "the configured index can't be used right now" — missing or incompatible. Callers (sync.ts, search.ts) catch this one type and degrade safely; neither case ever triggers a delete/recreate. */
export class PineconeIndexUnavailableError extends Error {}

export class PineconeIndexNotBootstrappedError extends PineconeIndexUnavailableError {
  constructor() {
    super(
      `Pinecone index "${serverEnv.PINECONE_INDEX_NAME}" does not exist yet. Run \`npm run pinecone:bootstrap\`.`,
    );
    this.name = "PineconeIndexNotBootstrappedError";
  }
}

export class PineconeIndexIncompatibleError extends PineconeIndexUnavailableError {
  constructor(detail: string) {
    super(detail);
    this.name = "PineconeIndexIncompatibleError";
  }
}

let pineconeClient: Pinecone | null = null;

function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({ apiKey: serverEnv.PINECONE_API_KEY });
  }
  return pineconeClient;
}

let cachedIndex: Promise<Index<GameVectorFields>> | null = null;

/**
 * Describes and validates the configured index — never creates, deletes, or
 * recreates it (that's `scripts/pinecone-bootstrap.mts`'s job alone).
 * Memoized on success only; a rejection is never cached, so the next call
 * retries (e.g. right after the operator runs bootstrap).
 */
export function ensureConfiguredIndex(): Promise<Index<GameVectorFields>> {
  if (cachedIndex) return cachedIndex;

  const attempt = (async () => {
    const pc = getPineconeClient();

    let indexModel;
    try {
      indexModel = await pc.describeIndex(serverEnv.PINECONE_INDEX_NAME);
    } catch (err) {
      if (err instanceof Errors.PineconeNotFoundError) {
        throw new PineconeIndexNotBootstrappedError();
      }
      throw err;
    }

    if (!isIndexCompatible(indexModel)) {
      throw new PineconeIndexIncompatibleError(
        describeIncompatibility(indexModel),
      );
    }

    return pc.index<GameVectorFields>({
      host: indexModel.host,
      namespace: PINECONE_NAMESPACE,
    });
  })();

  cachedIndex = attempt.catch((err: unknown) => {
    cachedIndex = null;
    throw err;
  });

  return cachedIndex;
}
