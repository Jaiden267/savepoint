// Resumable, bounded backfill of games/[slug]->Pinecone sync. Run with:
//   npm run pinecone:backfill -- [--limit N] [--retry-permanent-failures]
//
// Safety design, mirroring scripts/igdb-smoke-test.mts's conventions:
//   - .env.local loaded via process.loadEnvFile with a graceful fallback.
//   - Never prints PINECONE_API_KEY/SUPABASE_SECRET_KEY values.
//   - Describes the configured index only — never creates it. If missing or
//     incompatible, exits and points the operator at
//     `npm run pinecone:bootstrap`.
//   - Self-concurrency lock (PID file in the OS temp dir, outside any
//     tracked source path) refuses to run a second overlapping instance.
//   - Exactly the same recoverable-lease protocol as src/lib/pinecone/
//     sync.ts, reimplemented inline (can't import that `server-only`
//     module from a plain-Node script) — claim before any Pinecone work,
//     final writes conditional on both the claimed attempt_count and the
//     exact claim timestamp.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Pinecone, Errors } from "@pinecone-database/pinecone";
import type { Index } from "@pinecone-database/pinecone";
import {
  PINECONE_NAMESPACE,
  MAX_RECORDS_PER_UPSERT,
  BACKFILL_BATCH_SIZE,
  MAX_AUTO_RETRY_ATTEMPTS,
  SYNC_LEASE_MS,
  RETRY_COOLDOWN_MS,
} from "../src/lib/pinecone/constants.ts";
import {
  isIndexCompatible,
  describeIncompatibility,
} from "../src/lib/pinecone/index-compat.ts";
import {
  buildGameEmbeddingText,
  buildGameRecordFields,
} from "../src/lib/pinecone/record-text.ts";
import type { GameVectorFields } from "../src/lib/pinecone/record-text.ts";
import { sanitizeErrorForStorage } from "../src/lib/pinecone/error-sanitizer.ts";
import type { Database, TablesUpdate } from "../src/types/database.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const pineconeApiKey = process.env.PINECONE_API_KEY;
const indexName = process.env.PINECONE_INDEX_NAME || "savepoint-games";

if (!supabaseUrl || !supabaseSecretKey || !pineconeApiKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / PINECONE_API_KEY: " +
      "one or more MISSING. Cannot run without them (values never printed).",
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
function intFlag(name: string, fallback: number): number {
  const idx = argv.indexOf(name);
  if (idx === -1) return fallback;
  const parsed = Number(argv[idx + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const limit = intFlag("--limit", 200);
const retryPermanentFailures = argv.includes("--retry-permanent-failures");

const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pc = new Pinecone({ apiKey: pineconeApiKey });

// --- Self-concurrency lock ---------------------------------------------

const LOCK_PATH = path.join(os.tmpdir(), "savepoint-pinecone-backfill.lock");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): void {
  if (fs.existsSync(LOCK_PATH)) {
    const heldPid = Number(fs.readFileSync(LOCK_PATH, "utf8").trim());
    if (Number.isFinite(heldPid) && isProcessAlive(heldPid)) {
      console.error(
        `Another backfill run (pid ${heldPid}) appears to be in progress. Aborting.`,
      );
      process.exit(1);
    }
    // Stale lock (process no longer running) — safe to reclaim.
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}

function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // Already gone — fine.
  }
}

// --- Index validation (describe + validate only, never create) ---------

/**
 * Throws rather than calling process.exit() directly — this runs inside
 * main()'s try block, after acquireLock() has already written the lock
 * file. process.exit() terminates immediately without unwinding the stack,
 * which would skip main()'s `finally { releaseLock() }` and leave a stale
 * lock behind. Throwing lets that finally run; the top-level catch below
 * sets the process's exit code afterwards.
 */
async function getNamespace(): Promise<Index<GameVectorFields>> {
  let indexModel;
  try {
    indexModel = await pc.describeIndex(indexName);
  } catch (err) {
    if (err instanceof Errors.PineconeNotFoundError) {
      throw new Error(
        `Pinecone index "${indexName}" does not exist. Run \`npm run pinecone:bootstrap\` first.`,
      );
    }
    throw err;
  }
  if (!isIndexCompatible(indexModel)) {
    throw new Error(
      `Pinecone index "${indexName}" is incompatible: ${describeIncompatibility(indexModel)}`,
    );
  }
  return pc.index<GameVectorFields>({
    host: indexModel.host,
    namespace: PINECONE_NAMESPACE,
  });
}

// --- Candidate query + lease protocol (mirrors src/lib/pinecone/sync.ts) --

interface CandidateRow {
  game_id: string;
  status: string;
  attempt_count: number;
  last_attempted_at: string | null;
}

async function fetchCandidates(): Promise<CandidateRow[]> {
  const { data, error } = await admin
    .from("game_vector_sync")
    .select("game_id, status, attempt_count, last_attempted_at")
    .in("status", ["pending", "failed"])
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(
      `Failed to fetch candidate rows: ${sanitizeErrorForStorage(error)}`,
    );
  }
  return data ?? [];
}

type SkipReason =
  | "skipped_already_synced"
  | "skipped_retry_exhausted"
  | "skipped_concurrent"
  | "skipped_cooldown";

function checkEligibility(
  row: CandidateRow,
  now: number,
): { eligible: true } | { eligible: false; reason: SkipReason } {
  const lastAttemptedAtMs = row.last_attempted_at
    ? new Date(row.last_attempted_at).getTime()
    : null;

  if (row.status === "synced") {
    return { eligible: false, reason: "skipped_already_synced" };
  }
  if (
    row.status === "failed" &&
    row.attempt_count >= MAX_AUTO_RETRY_ATTEMPTS &&
    !retryPermanentFailures
  ) {
    return { eligible: false, reason: "skipped_retry_exhausted" };
  }
  if (
    row.status === "pending" &&
    lastAttemptedAtMs !== null &&
    now - lastAttemptedAtMs < SYNC_LEASE_MS
  ) {
    return { eligible: false, reason: "skipped_concurrent" };
  }
  if (
    row.status === "failed" &&
    lastAttemptedAtMs !== null &&
    now - lastAttemptedAtMs < RETRY_COOLDOWN_MS
  ) {
    return { eligible: false, reason: "skipped_cooldown" };
  }
  return { eligible: true };
}

interface ClaimedGame {
  gameId: string;
  attemptCount: number;
  claimTimestamp: string;
}

async function claimRow(row: CandidateRow): Promise<ClaimedGame | null> {
  const claimTimestamp = new Date().toISOString();
  const attemptCount = row.attempt_count + 1;
  const { data } = await admin
    .from("game_vector_sync")
    .update({
      attempt_count: attemptCount,
      status: "pending",
      last_attempted_at: claimTimestamp,
    })
    .eq("game_id", row.game_id)
    .eq("attempt_count", row.attempt_count)
    .select("game_id");

  if (!data || data.length === 0) return null;
  return { gameId: row.game_id, attemptCount, claimTimestamp };
}

async function finalizeRow(
  claimed: ClaimedGame,
  outcome: { status: "synced" } | { status: "failed"; error: string },
): Promise<void> {
  const payload: TablesUpdate<"game_vector_sync"> =
    outcome.status === "synced"
      ? {
          status: "synced",
          last_synced_at: new Date().toISOString(),
          error: null,
        }
      : { status: "failed", error: outcome.error };

  await admin
    .from("game_vector_sync")
    .update(payload)
    .eq("game_id", claimed.gameId)
    .eq("attempt_count", claimed.attemptCount)
    .eq("last_attempted_at", claimed.claimTimestamp);
}

// --- Inline join-fetch (reimplements src/server/services/game-refs.ts) --

interface NamedRef {
  id: number;
  name: string;
  slug: string;
}

async function fetchTaggedRefs(
  joinTable:
    "game_genres" | "game_platforms" | "game_game_modes" | "game_themes",
  joinColumn: "genre_id" | "platform_id" | "game_mode_id" | "theme_id",
  refTable: "genres" | "platforms" | "game_modes" | "themes",
  gameId: string,
): Promise<NamedRef[]> {
  const { data: links } = await admin
    .from(joinTable)
    .select("*")
    .eq("game_id", gameId);
  const ids = (links ?? [])
    .map((link) => (link as unknown as Record<string, number>)[joinColumn])
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0) return [];
  const { data: refs } = await admin
    .from(refTable)
    .select("id, name, slug")
    .in("id", ids);
  return refs ?? [];
}

async function getGameTaggedRefs(gameId: string) {
  const [genres, platforms, gameModes, themes] = await Promise.all([
    fetchTaggedRefs("game_genres", "genre_id", "genres", gameId),
    fetchTaggedRefs("game_platforms", "platform_id", "platforms", gameId),
    fetchTaggedRefs("game_game_modes", "game_mode_id", "game_modes", gameId),
    fetchTaggedRefs("game_themes", "theme_id", "themes", gameId),
  ]);
  return { genres, platforms, gameModes, themes };
}

type PineconeUpsertRecord = { id: string; text: string } & GameVectorFields;

async function buildRecordForGame(
  gameId: string,
): Promise<PineconeUpsertRecord> {
  const { data: gameRow, error } = await admin
    .from("games")
    .select(
      "id, igdb_id, slug, name, summary, storyline, release_date, cover_image_id, keywords",
    )
    .eq("id", gameId)
    .single();
  if (error || !gameRow) throw error ?? new Error("game row not found");

  const refs = await getGameTaggedRefs(gameId);
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

  return { id: gameId, text, ...fields };
}

const MAX_TRANSIENT_RETRIES = 3;

function isTransientPineconeError(err: unknown): boolean {
  return (
    err instanceof Errors.PineconeInternalServerError ||
    err instanceof Errors.PineconeUnavailableError ||
    err instanceof Errors.PineconeTimeoutError ||
    err instanceof Errors.PineconeMaxRetriesExceededError
  );
}

async function upsertBatchWithRetry(
  namespace: Index<GameVectorFields>,
  records: PineconeUpsertRecord[],
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      await namespace.upsertRecords({ records });
      return { ok: true };
    } catch (err) {
      lastError = err;
      if (!isTransientPineconeError(err) || attempt === MAX_TRANSIENT_RETRIES) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return { ok: false, error: lastError };
}

async function main() {
  acquireLock();
  try {
    console.log("\n=== Savepoint Pinecone backfill ===\n");
    const namespace = await getNamespace();

    const candidates = await fetchCandidates();
    console.log(`Candidates fetched: ${candidates.length} (limit ${limit})`);

    const now = Date.now();
    const claimed: ClaimedGame[] = [];
    const skipCounts: Record<SkipReason, number> = {
      skipped_already_synced: 0,
      skipped_retry_exhausted: 0,
      skipped_concurrent: 0,
      skipped_cooldown: 0,
    };

    for (const row of candidates) {
      const eligibility = checkEligibility(row, now);
      if (!eligibility.eligible) {
        skipCounts[eligibility.reason] += 1;
        continue;
      }
      const claim = await claimRow(row);
      if (!claim) {
        skipCounts.skipped_concurrent += 1;
        continue;
      }
      claimed.push(claim);
    }

    console.log(`Claimed ${claimed.length} row(s) for this run.\n`);

    let syncedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < claimed.length; i += BACKFILL_BATCH_SIZE) {
      const batch = claimed
        .slice(i, i + BACKFILL_BATCH_SIZE)
        .slice(0, MAX_RECORDS_PER_UPSERT);

      const entries: {
        claimed: ClaimedGame;
        record?: PineconeUpsertRecord;
        buildError?: unknown;
      }[] = [];
      for (const item of batch) {
        try {
          const record = await buildRecordForGame(item.gameId);
          entries.push({ claimed: item, record });
        } catch (err) {
          entries.push({ claimed: item, buildError: err });
        }
      }

      const buildable = entries.filter(
        (entry): entry is typeof entry & { record: PineconeUpsertRecord } =>
          entry.record !== undefined,
      );
      const upsertResult =
        buildable.length > 0
          ? await upsertBatchWithRetry(
              namespace,
              buildable.map((entry) => entry.record),
            )
          : { ok: true as const };

      for (const entry of entries) {
        if (entry.buildError) {
          await finalizeRow(entry.claimed, {
            status: "failed",
            error: sanitizeErrorForStorage(entry.buildError),
          });
          failedCount += 1;
          continue;
        }
        if (upsertResult.ok) {
          await finalizeRow(entry.claimed, { status: "synced" });
          syncedCount += 1;
        } else {
          await finalizeRow(entry.claimed, {
            status: "failed",
            error: sanitizeErrorForStorage(upsertResult.error),
          });
          failedCount += 1;
        }
      }
    }

    console.log(`Synced: ${syncedCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log(
      `Skipped (already synced): ${skipCounts.skipped_already_synced}`,
    );
    console.log(
      `Skipped (retry exhausted): ${skipCounts.skipped_retry_exhausted}`,
    );
    console.log(`Skipped (active lease): ${skipCounts.skipped_concurrent}`);
    console.log(`Skipped (cooldown): ${skipCounts.skipped_cooldown}`);

    const stats = await namespace.describeIndexStats();
    const nsStats = stats.namespaces?.[PINECONE_NAMESPACE];
    console.log(`\nIndex:     ${indexName}`);
    console.log(`Namespace: ${PINECONE_NAMESPACE}`);
    console.log(`Records:   ${nsStats?.recordCount ?? "unknown"}\n`);
  } finally {
    releaseLock();
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
