/**
 * Shared, secret-free Pinecone configuration. Pure — importable from app
 * runtime code (via client.ts/sync.ts/search.ts) and from the plain-Node
 * scripts (bootstrap/backfill/smoke-test), which cannot import anything
 * marked `server-only`.
 */

/** Namespace all game vectors live in within the configured index. */
export const PINECONE_NAMESPACE = "games";

/** Pinecone integrated-embedding model used for the games index. */
export const EMBED_MODEL = "llama-text-embed-v2";

/** Record field name mapped to the embedding model via the index's fieldMap. */
export const TEXT_FIELD = "text";

/** Pinecone's hard limit for text records upserted to an integrated-embedding index (model-imposed, not index-imposed). */
export const MAX_RECORDS_PER_UPSERT = 96;

/** Backfill upsert batch size — comfortably under MAX_RECORDS_PER_UPSERT. */
export const BACKFILL_BATCH_SIZE = 25;

/** Character budget for composed embedding text — defense in depth on top of Pinecone's own truncate:"END" default for the 2048-token model limit. */
export const MAX_TEXT_CHARS = 6000;

/** A failed row is no longer auto-retried once its attempt_count reaches this — permanently failed unless an operator explicitly retries it. */
export const MAX_AUTO_RETRY_ATTEMPTS = 5;

/** How long a claimed-but-unfinished sync attempt is considered actively in flight before another worker may reclaim the row. */
export const SYNC_LEASE_MS = 5 * 60 * 1000;

/** How long a failed row must sit before it's eligible for another automatic attempt — distinct from, and longer than, the in-flight lease. */
export const RETRY_COOLDOWN_MS = 15 * 60 * 1000;
