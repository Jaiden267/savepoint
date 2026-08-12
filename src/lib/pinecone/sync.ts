import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGameTaggedRefs } from "@/server/services/game-refs";
import {
  ensureConfiguredIndex,
  PineconeIndexUnavailableError,
} from "./client.ts";
import {
  buildGameEmbeddingText,
  buildGameRecordFields,
} from "./record-text.ts";
import { sanitizeErrorForStorage } from "./error-sanitizer.ts";
import {
  MAX_AUTO_RETRY_ATTEMPTS,
  SYNC_LEASE_MS,
  RETRY_COOLDOWN_MS,
} from "./constants.ts";
import type { TablesUpdate } from "@/types/database";

export type SyncOutcome =
  | { status: "synced" }
  | { status: "failed"; error: string }
  | { status: "skipped_already_synced" }
  | { status: "skipped_retry_exhausted" }
  | { status: "skipped_cooldown" }
  | { status: "skipped_concurrent" }
  | { status: "deferred"; reason: string };

// Wraps the *entire* operation, before any status/index checks — a
// same-process optimization only. The real cross-process guarantee is the
// database-level lease claimed below (see runSync).
const inFlight = new Map<string, Promise<SyncOutcome>>();

/**
 * Syncs one game's Pinecone record, protected by a recoverable lease built
 * entirely from `game_vector_sync`'s existing `status`/`last_attempted_at`/
 * `attempt_count` columns (no migration). Never throws — every failure mode
 * resolves to a typed outcome instead. Safe to call unconditionally on every
 * resolved game view: already-synced and retry-exhausted rows short-circuit
 * before any Pinecone or claim call.
 */
export function syncGameVector(gameId: string): Promise<SyncOutcome> {
  const existing = inFlight.get(gameId);
  if (existing) return existing;

  const promise = runSync(gameId).finally(() => {
    inFlight.delete(gameId);
  });
  inFlight.set(gameId, promise);
  return promise;
}

async function runSync(gameId: string): Promise<SyncOutcome> {
  const admin = createAdminClient();

  const { data: row, error: readError } = await admin
    .from("game_vector_sync")
    .select("status, attempt_count, last_attempted_at")
    .eq("game_id", gameId)
    .maybeSingle();

  if (readError || !row) {
    // Shouldn't happen in practice — every `games` row gets a
    // `game_vector_sync` row on import — but this is a global/environmental
    // problem, not this game's fault, so it's deferred rather than claimed
    // and marked failed.
    return {
      status: "deferred",
      reason: "game_vector_sync row unavailable",
    };
  }

  const now = Date.now();
  const previousCount = row.attempt_count;
  const lastAttemptedAtMs = row.last_attempted_at
    ? new Date(row.last_attempted_at).getTime()
    : null;

  if (row.status === "synced") {
    return { status: "skipped_already_synced" };
  }

  if (row.status === "failed" && previousCount >= MAX_AUTO_RETRY_ATTEMPTS) {
    return { status: "skipped_retry_exhausted" };
  }

  if (
    row.status === "pending" &&
    lastAttemptedAtMs !== null &&
    now - lastAttemptedAtMs < SYNC_LEASE_MS
  ) {
    // Another worker's claim is still active.
    return { status: "skipped_concurrent" };
  }

  if (
    row.status === "failed" &&
    lastAttemptedAtMs !== null &&
    now - lastAttemptedAtMs < RETRY_COOLDOWN_MS
  ) {
    return { status: "skipped_cooldown" };
  }

  // Eligible. Check the global index config *before* claiming — a missing
  // or incompatible index is not this game's fault and must not consume its
  // retry budget.
  let namespace;
  try {
    namespace = await ensureConfiguredIndex();
  } catch (err) {
    if (err instanceof PineconeIndexUnavailableError) {
      return { status: "deferred", reason: err.message };
    }
    throw err;
  }

  const claimTimestamp = new Date().toISOString();
  const { data: claimedRows } = await admin
    .from("game_vector_sync")
    .update({
      attempt_count: previousCount + 1,
      status: "pending",
      last_attempted_at: claimTimestamp,
    })
    .eq("game_id", gameId)
    .eq("attempt_count", previousCount)
    .select("game_id");

  if (!claimedRows || claimedRows.length === 0) {
    // Another worker claimed between our read and our write.
    return { status: "skipped_concurrent" };
  }

  async function finalize(
    outcome: { status: "synced" } | { status: "failed"; error: string },
  ): Promise<SyncOutcome> {
    const payload: TablesUpdate<"game_vector_sync"> =
      outcome.status === "synced"
        ? {
            status: "synced",
            last_synced_at: new Date().toISOString(),
            error: null,
          }
        : { status: "failed", error: outcome.error };

    // Conditional on BOTH the claimed attempt_count and the exact claim
    // timestamp — if the lease has since expired and a newer worker
    // reclaimed the row, neither condition matches and this write is
    // silently discarded instead of clobbering the newer worker's result.
    await admin
      .from("game_vector_sync")
      .update(payload)
      .eq("game_id", gameId)
      .eq("attempt_count", previousCount + 1)
      .eq("last_attempted_at", claimTimestamp);

    return outcome;
  }

  try {
    const { data: gameRow, error: gameError } = await admin
      .from("games")
      .select(
        "id, igdb_id, slug, name, summary, storyline, release_date, cover_image_id, keywords",
      )
      .eq("id", gameId)
      .single();
    if (gameError || !gameRow) {
      throw gameError ?? new Error("game row not found");
    }

    const refs = await getGameTaggedRefs(admin, gameId);

    const text = buildGameEmbeddingText({
      name: gameRow.name,
      summary: gameRow.summary,
      storyline: gameRow.storyline,
      keywords: gameRow.keywords,
      genres: refs.genres,
      platforms: refs.platforms,
      gameModes: refs.gameModes,
      themes: refs.themes,
    });
    const fields = buildGameRecordFields({
      gameId: gameRow.id,
      igdbId: gameRow.igdb_id,
      slug: gameRow.slug,
      name: gameRow.name,
      releaseDate: gameRow.release_date,
      genres: refs.genres,
      platforms: refs.platforms,
      coverImageId: gameRow.cover_image_id,
    });

    await namespace.upsertRecords({
      records: [{ id: gameId, text, ...fields }],
    });

    return await finalize({ status: "synced" });
  } catch (err) {
    return await finalize({
      status: "failed",
      error: sanitizeErrorForStorage(err),
    });
  }
}
