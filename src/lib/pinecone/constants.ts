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

/** Current Pinecone record schema version written by syncGameVector/the catalogue sync — a `game_vector_sync.schema_version` less than this (or null) is re-synced, not skipped, on next touch. */
export const PINECONE_SCHEMA_VERSION = 2;

/** How long the single global catalogue lease (discover/sync/incremental/release-check) is held before it's considered stale and reclaimable. */
export const CATALOGUE_LEASE_MS = 5 * 60 * 1000;

/** How often a running catalogue command renews its lease — comfortably under a third of CATALOGUE_LEASE_MS so a slow batch never lets the lease lapse. */
export const CATALOGUE_LEASE_HEARTBEAT_MS = 90 * 1000;

/** Safety overlap window for incremental/release-check watermarks — a cursor never advances past (scanStartedAt - this), so every run re-examines a small, cheap, idempotent buffer to cover writes that hadn't settled at query time. */
export const INCREMENTAL_OVERLAP_SECONDS = 300;

/** Multiplier applied to the raw chars/4 token estimate to absorb its observed ±30% uncertainty, used by both the monthly ceiling and the per-minute pacer. */
export const EMBEDDING_TOKEN_SAFETY_MULTIPLIER = 1.3;

/** Pinecone Starter plan's documented passage (upsert) embedding throughput limit for llama-text-embed-v2 — confirmed live against docs.pinecone.io/reference/api/database-limits. */
export const PINECONE_PASSAGE_TOKENS_PER_MINUTE_LIMIT = 250_000;

/** The catalogue sync's actual pacing target — 60% of the documented limit, deliberately leaving headroom for concurrent ordinary on-demand traffic sharing the same project-level allowance, not just for estimate error. */
export const PINECONE_PASSAGE_TOKENS_PER_MINUTE_TARGET = 150_000;
