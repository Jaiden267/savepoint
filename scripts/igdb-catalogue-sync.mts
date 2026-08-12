// Gate C/D/E operator tool for broad IGDB catalogue semantic indexing
// (Prompt 7C). NOT part of `npm test`. Run manually with:
//   npm run igdb:catalogue-sync -- <command> [flags]
//
// Commands:
//   discover        --profile <p> [--new-generation] [--page-size N] [--execute + ceilings]
//   incremental      --profile <p> [--page-size N] [--execute + ceilings]
//   release-check    --profile <p> [--page-size N] [--execute + ceilings]
//   sync              [--execute + ceilings]
//   status             [--max-pages N] [--max-records N]
//   verify              [--sample N] [--max-pages N] [--max-records N]
//
// Safety design:
//   - Dry-run is the default for every mutating command — nothing is
//     written to Supabase or Pinecone unless `--execute` is passed.
//   - `--execute` on discover/incremental/release-check/sync REQUIRES all
//     four: --limit, --max-requests, --max-runtime-minutes,
//     --max-estimated-embedding-tokens. Missing any one is a hard,
//     immediate error before any external call is made.
//   - The ceiling check runs once between IGDB pages, never mid-page — each
//     page is applied to the ledger as one atomic RPC call. IGDB pages at up
//     to 500 records by default, so a small --limit (e.g. a canary run)
//     should be paired with --page-size to keep a single page/RPC call from
//     overshooting --limit. --page-size is clamped to [1, 500] and defaults
//     to 500 (unchanged behavior) when omitted.
//   - One global, fenced, heartbeat-renewed lease (src/lib/pinecone/lease.ts)
//     is held for the entire duration of any mutating command — discover/
//     incremental/release-check/sync can never run concurrently with each
//     other or with themselves. status/verify never touch it.
//   - Every candidate-discovery write goes through the single atomic
//     checkpoint RPC (advance_catalogue_discovery) via a real
//     compare-and-set on a deterministic page key
//     (src/lib/pinecone/catalogue-page-key.ts) — see the migration file's
//     own comments for the full fencing/idempotency design.
//   - SIGINT/SIGTERM save progress (already-committed via the RPC/ledger),
//     release the lease, and exit 130/143 — never 0. Exit 0 means the
//     bounded operation genuinely reached its limit, exhausted all
//     candidates, or stopped cleanly at an operator ceiling (a designed,
//     successful outcome, not an interruption).
//   - Never prints IGDB_CLIENT_ID/IGDB_CLIENT_SECRET/SUPABASE_SECRET_KEY/
//     PINECONE_API_KEY values.
//
// Why this reimplements the IGDB token/request glue and Pinecone namespace
// access inline rather than importing the `server-only` app-runtime
// modules: see scripts/pinecone-backfill.mts's header comment — same
// constraint, same precedent. Every pure module this script needs
// (catalogue-profile.ts, catalogue-page-key.ts, embed-rate-pacer.ts,
// lease.ts, apicalypse.ts, mappers.ts, record-text.ts, error-sanitizer.ts)
// is deliberately NOT `server-only`, so it's imported directly.

import { createClient } from "@supabase/supabase-js";
import { Pinecone, Errors } from "@pinecone-database/pinecone";
import type { Index } from "@pinecone-database/pinecone";
import {
  PINECONE_NAMESPACE,
  MAX_RECORDS_PER_UPSERT,
  BACKFILL_BATCH_SIZE,
  INCREMENTAL_OVERLAP_SECONDS,
} from "../src/lib/pinecone/constants.ts";
import {
  isIndexCompatible,
  describeIncompatibility,
} from "../src/lib/pinecone/index-compat.ts";
import {
  buildGameEmbeddingText,
  buildGameRecordFields,
  type GameVectorFields,
} from "../src/lib/pinecone/record-text.ts";
import { sanitizeErrorForStorage } from "../src/lib/pinecone/error-sanitizer.ts";
import {
  CatalogueLease,
  CatalogueLeaseNotAcquiredError,
} from "../src/lib/pinecone/lease.ts";
import { buildCataloguePageKey } from "../src/lib/pinecone/catalogue-page-key.ts";
import { EmbedRatePacer } from "../src/lib/pinecone/embed-rate-pacer.ts";
import { runSyncOrchestration } from "../src/lib/pinecone/sync-orchestrator.ts";
import {
  CATALOGUE_PROFILES,
  isEligibleForCatalogue,
  buildCatalogueWhereClause,
  buildIncrementalWhereClause,
  buildReleaseCheckWhereClause,
  type CatalogueProfileName,
  type GameTypeRef,
  type CatalogueScanCandidate,
} from "../src/lib/igdb/catalogue-profile.ts";
import {
  buildCatalogueScanQuery,
  buildCatalogueDetailBatchQuery,
  CATALOGUE_SCAN_PAGE_LIMIT,
  CATALOGUE_DETAIL_BATCH_LIMIT,
} from "../src/lib/igdb/apicalypse.ts";
import { mapIgdbGameToRow } from "../src/lib/igdb/mappers.ts";
import type { IgdbGameDetailRaw } from "../src/lib/igdb/types.ts";
import type { Database, Json } from "../src/types/database.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const pineconeApiKey = process.env.PINECONE_API_KEY;
const pineconeIndexName = process.env.PINECONE_INDEX_NAME || "savepoint-games";
const igdbClientId = process.env.IGDB_CLIENT_ID;
const igdbClientSecret = process.env.IGDB_CLIENT_SECRET;

if (
  !supabaseUrl ||
  !supabaseSecretKey ||
  !pineconeApiKey ||
  !igdbClientId ||
  !igdbClientSecret
) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / PINECONE_API_KEY / " +
      "IGDB_CLIENT_ID / IGDB_CLIENT_SECRET: one or more MISSING. Cannot " +
      "run without them (values are never printed).",
  );
  process.exit(1);
}

const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pc = new Pinecone({ apiKey: pineconeApiKey });

// --- CLI parsing -------------------------------------------------------

const argv = process.argv.slice(2);
const command = argv[0];
const flags = argv.slice(1);

function flagValue(name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}
function intFlag(name: string): number | undefined {
  const raw = flagValue(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
const execute = flags.includes("--execute");
const profileFlag = flagValue("--profile") as CatalogueProfileName | undefined;
const newGeneration = flags.includes("--new-generation");

// IGDB pages at up to CATALOGUE_SCAN_PAGE_LIMIT (500) records per request,
// and each page is applied to the ledger as one atomic RPC call — the
// ceiling check only runs *between* pages (never mid-page, matching the
// plan's "checked before each batch" design). For a small canary/bounded
// run (e.g. --limit 25), a full 500-record page would blow straight past
// --limit in that single RPC call. --page-size lets an operator shrink the
// scan page to match a small --limit; it's clamped to
// [1, CATALOGUE_SCAN_PAGE_LIMIT] and defaults to CATALOGUE_SCAN_PAGE_LIMIT
// (unchanged behavior) when omitted.
const pageSizeFlag = intFlag("--page-size");
const scanPageSize =
  pageSizeFlag !== undefined
    ? Math.min(pageSizeFlag, CATALOGUE_SCAN_PAGE_LIMIT)
    : CATALOGUE_SCAN_PAGE_LIMIT;

interface Ceilings {
  limit: number;
  maxRequests: number;
  maxRuntimeMinutes: number;
  maxEstimatedEmbeddingTokens: number;
}

function requireCeilings(): Ceilings {
  const limit = intFlag("--limit");
  const maxRequests = intFlag("--max-requests");
  const maxRuntimeMinutes = intFlag("--max-runtime-minutes");
  const maxEstimatedEmbeddingTokens = intFlag(
    "--max-estimated-embedding-tokens",
  );
  const missing = [
    !limit && "--limit",
    !maxRequests && "--max-requests",
    !maxRuntimeMinutes && "--max-runtime-minutes",
    !maxEstimatedEmbeddingTokens && "--max-estimated-embedding-tokens",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(
      `--execute requires all four ceilings; missing: ${missing.join(", ")}. ` +
        "--execute alone never authorizes an unbounded run.",
    );
    process.exit(1);
  }
  return {
    limit: limit!,
    maxRequests: maxRequests!,
    maxRuntimeMinutes: maxRuntimeMinutes!,
    maxEstimatedEmbeddingTokens: maxEstimatedEmbeddingTokens!,
  };
}

// --- Ceiling tracking + graceful shutdown -------------------------------

type StopReason =
  | { kind: "limit_reached" }
  | { kind: "exhausted" }
  | { kind: "ceiling"; which: string }
  | { kind: "interrupted"; signal: "SIGINT" | "SIGTERM" }
  | { kind: "lease_lost" };

class RunTracker {
  requestsMade = 0;
  itemsProcessed = 0;
  estimatedTokens = 0;
  readonly startedAt = Date.now();
  private shuttingDown: StopReason | null = null;
  // Not a TS parameter-property (`constructor(private readonly x)`) —
  // Node's native strip-only TypeScript mode (used to run this plain
  // .mts script directly) doesn't support that syntax, unlike the real
  // `tsc`/webpack Next uses for app code. Every file this script imports,
  // directly or transitively, must avoid parameter properties for the
  // same reason — see lease.ts/embed-rate-pacer.ts.
  private readonly ceilings: Ceilings | null;

  constructor(ceilings: Ceilings | null) {
    this.ceilings = ceilings;
  }

  get interrupted(): StopReason | null {
    return this.shuttingDown;
  }

  /** Tokens still available under --max-estimated-embedding-tokens before the next upsert, given what's already been spent this run. Infinity when no ceiling is in effect (dry-run without an explicit token ceiling). */
  remainingTokenAllowance(): number {
    if (!this.ceilings) return Number.POSITIVE_INFINITY;
    return Math.max(
      0,
      this.ceilings.maxEstimatedEmbeddingTokens - this.estimatedTokens,
    );
  }

  /** Items still available under --limit before the next fetch window, given what's already been processed this run. Infinity when no ceiling is in effect. Used to size sync's IGDB detail-fetch window precisely, so a bounded run's item count is never overshot by a partial-batch's worth. */
  remainingItemAllowance(): number {
    if (!this.ceilings) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.ceilings.limit - this.itemsProcessed);
  }

  requestSignalShutdown(reason: StopReason) {
    if (!this.shuttingDown) this.shuttingDown = reason;
  }

  /** Checked before starting each new unit of work (page/batch) — never mid-unit. */
  shouldStop(): StopReason | null {
    if (this.shuttingDown) return this.shuttingDown;
    if (!this.ceilings) return null;
    if (this.itemsProcessed >= this.ceilings.limit)
      return { kind: "limit_reached" };
    if (this.requestsMade >= this.ceilings.maxRequests) {
      return { kind: "ceiling", which: "--max-requests" };
    }
    const elapsedMinutes = (Date.now() - this.startedAt) / 60_000;
    if (elapsedMinutes >= this.ceilings.maxRuntimeMinutes) {
      return { kind: "ceiling", which: "--max-runtime-minutes" };
    }
    if (this.estimatedTokens >= this.ceilings.maxEstimatedEmbeddingTokens) {
      return { kind: "ceiling", which: "--max-estimated-embedding-tokens" };
    }
    return null;
  }
}

let sigintReceived: "SIGINT" | "SIGTERM" | null = null;
let activeTracker: RunTracker | null = null;
function installSignalHandlers() {
  const handler = (signal: "SIGINT" | "SIGTERM") => {
    sigintReceived = signal;
    activeTracker?.requestSignalShutdown({ kind: "interrupted", signal });
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}

function exitCodeForStop(reason: StopReason | null): number {
  if (!reason) return 0;
  switch (reason.kind) {
    case "limit_reached":
    case "exhausted":
    case "ceiling":
      return 0; // designed, successful bounded completion
    case "interrupted":
      return reason.signal === "SIGINT" ? 130 : 143;
    case "lease_lost":
      return 2;
  }
}

// --- IGDB helpers --------------------------------------------------------

let lastIgdbRequestAt = 0;
const MIN_IGDB_REQUEST_SPACING_MS = 260; // slightly under the documented 4 req/s

async function pace() {
  const wait = MIN_IGDB_REQUEST_SPACING_MS - (Date.now() - lastIgdbRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastIgdbRequestAt = Date.now();
}

let cachedToken: { token: string; expiresAt: number } | null = null;
async function getIgdbToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.token;
  }
  const params = new URLSearchParams({
    client_id: igdbClientId!,
    client_secret: igdbClientSecret!,
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?${params.toString()}`,
    {
      method: "POST",
    },
  );
  if (!res.ok)
    throw new Error(`Twitch token request failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

const MAX_IGDB_ATTEMPTS = 3;

/** Retries only on 429/5xx, honoring Retry-After when present, otherwise exponential backoff + jitter — matching src/lib/igdb/client.ts's documented behavior (reimplemented here per this file's header comment). */
async function igdbFetch<T>(
  tracker: RunTracker,
  endpoint: string,
  body: string,
): Promise<T[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_IGDB_ATTEMPTS; attempt += 1) {
    await pace();
    const token = await getIgdbToken();
    tracker.requestsMade += 1;
    const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": igdbClientId!,
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      return res.json() as Promise<T[]>;
    }
    if (res.status !== 429 && res.status < 500) {
      const text = await res.text();
      throw new Error(
        `${endpoint} request failed: HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    lastError = new Error(`${endpoint} request failed: HTTP ${res.status}`);
    if (attempt === MAX_IGDB_ATTEMPTS) break;
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : null;
    const backoffMs =
      retryAfterMs ?? 2 ** (attempt - 1) * 500 + Math.random() * 200;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  throw lastError;
}

// --- Pinecone helpers ----------------------------------------------------

async function getNamespace(): Promise<Index<GameVectorFields>> {
  let indexModel;
  try {
    indexModel = await pc.describeIndex(pineconeIndexName);
  } catch (err) {
    if (err instanceof Errors.PineconeNotFoundError) {
      throw new Error(
        `Pinecone index "${pineconeIndexName}" does not exist. Run \`npm run pinecone:bootstrap\` first.`,
      );
    }
    throw err;
  }
  if (!isIndexCompatible(indexModel)) {
    throw new Error(
      `Pinecone index "${pineconeIndexName}" is incompatible: ${describeIncompatibility(indexModel)}`,
    );
  }
  return pc.index<GameVectorFields>({
    host: indexModel.host,
    namespace: PINECONE_NAMESPACE,
  });
}

// --- game_types resolution (never hardcoded) ------------------------------

async function resolveGameTypes(tracker: RunTracker): Promise<GameTypeRef[]> {
  return igdbFetch<GameTypeRef>(
    tracker,
    "game_types",
    "fields id,type; limit 50;",
  );
}

// --- Checkpoint RPC helper -------------------------------------------------

interface RpcPage {
  cursorName: string;
  candidates: { igdbId: number; profile: string; igdbUpdatedAtUnix: number }[];
  markIneligible: number[];
  newLastIgdbId: number | null;
  newLastUpdatedAtUnix: number | null;
  newLastUpdatedAtIgdbId: number | null;
  newLastReleaseCheckUnix: number | null;
  newLastReleaseCheckIgdbId: number | null;
  markCompleted: boolean;
}

async function applyPage(
  lease: CatalogueLease,
  expectedPreviousPageKey: string | null,
  page: RpcPage,
): Promise<{
  status: string;
  candidatesEncountered: number;
  newLedgerRows: number;
}> {
  const pageKey = buildCataloguePageKey(page);
  type RpcArgs = Omit<
    Database["public"]["Functions"]["advance_catalogue_discovery"]["Args"],
    | "p_expected_previous_page_key"
    | "p_new_last_igdb_id"
    | "p_new_last_updated_at_unix"
    | "p_new_last_updated_at_igdb_id"
    | "p_new_last_release_check_unix"
    | "p_new_last_release_check_igdb_id"
  > & {
    p_expected_previous_page_key: string | null;
    p_new_last_igdb_id: number | null;
    p_new_last_updated_at_unix: number | null;
    p_new_last_updated_at_igdb_id: number | null;
    p_new_last_release_check_unix: number | null;
    p_new_last_release_check_igdb_id: number | null;
  };
  const args: RpcArgs = {
    p_cursor_name: page.cursorName,
    p_lease_token: lease.requireToken(),
    p_page_key: pageKey,
    p_expected_previous_page_key: expectedPreviousPageKey,
    p_candidates: page.candidates.map((c) => ({
      igdb_id: c.igdbId,
      profile: c.profile,
      igdb_updated_at_unix: c.igdbUpdatedAtUnix,
    })) as Json,
    p_mark_ineligible: page.markIneligible,
    p_new_last_igdb_id: page.newLastIgdbId,
    p_new_last_updated_at_unix: page.newLastUpdatedAtUnix,
    p_new_last_updated_at_igdb_id: page.newLastUpdatedAtIgdbId,
    p_new_last_release_check_unix: page.newLastReleaseCheckUnix,
    p_new_last_release_check_igdb_id: page.newLastReleaseCheckIgdbId,
    p_mark_completed: page.markCompleted,
  };
  const { data, error } = await admin.rpc(
    "advance_catalogue_discovery",
    args as Database["public"]["Functions"]["advance_catalogue_discovery"]["Args"],
  );
  if (error)
    throw new Error(`advance_catalogue_discovery failed: ${error.message}`);
  const result = data as {
    status: string;
    candidates_encountered?: number;
    new_ledger_rows?: number;
  };
  return {
    status: result.status,
    candidatesEncountered: result.candidates_encountered ?? 0,
    newLedgerRows: result.new_ledger_rows ?? 0,
  };
}

async function readCursor(cursorName: string) {
  const { data } = await admin
    .from("igdb_catalogue_discovery_cursor")
    .select("*")
    .eq("cursor_name", cursorName)
    .maybeSingle();
  return data;
}

// --- discover --------------------------------------------------------------

function toScanCandidate(raw: {
  id: number;
  game_type?: { type?: string } | null;
  first_release_date?: number | null;
  cover?: { image_id?: string } | null;
  summary?: string | null;
  storyline?: string | null;
  total_rating_count?: number | null;
  updated_at?: number | null;
}): CatalogueScanCandidate {
  return {
    id: raw.id,
    gameType: raw.game_type?.type ?? null,
    firstReleaseDateUnix: raw.first_release_date ?? null,
    coverImageId: raw.cover?.image_id ?? null,
    summary: raw.summary ?? null,
    storyline: raw.storyline ?? null,
    totalRatingCount: raw.total_rating_count ?? null,
    updatedAtUnix: raw.updated_at ?? null,
  };
}

async function runDiscover(
  profile: CatalogueProfileName,
  tracker: RunTracker,
  lease: CatalogueLease | null,
) {
  const gameTypes = await resolveGameTypes(tracker);
  const now = Math.floor(Date.now() / 1000);

  const generation = newGeneration
    ? await nextGeneration(profile)
    : await currentGeneration(profile);
  const cursorName = `discover:${profile}:gen${generation}`;
  const cursor = await readCursor(cursorName);
  if (cursor?.completed_at && !newGeneration) {
    console.log(
      `Generation ${generation} already completed at ${cursor.completed_at}. Pass --new-generation to run a fresh full rescan.`,
    );
    return { kind: "exhausted" } satisfies StopReason;
  }

  // Seed release-check's watermark on this profile's very first generation-1
  // run, once — see docs/PINECONE.md's "release-check initialization"
  // section. A NULL watermark would silently scan nothing forever.
  if (generation === 1 && lease) {
    const releaseCursorName = `release-check:${profile}`;
    const releaseCursor = await readCursor(releaseCursorName);
    if (!releaseCursor?.last_release_check) {
      const seedUnix =
        Math.floor(Date.now() / 1000) - INCREMENTAL_OVERLAP_SECONDS;
      const seedPage: RpcPage = {
        cursorName: releaseCursorName,
        candidates: [],
        markIneligible: [],
        newLastIgdbId: null,
        newLastUpdatedAtUnix: null,
        newLastUpdatedAtIgdbId: null,
        newLastReleaseCheckUnix: seedUnix,
        newLastReleaseCheckIgdbId: 0,
        markCompleted: false,
      };
      const applied = await applyPage(lease, null, seedPage);
      console.log(
        `Seeded release-check watermark for "${profile}" at ${new Date(seedUnix * 1000).toISOString()} (${applied.status})`,
      );
    }
  }

  let lastIgdbId = cursor?.last_igdb_id ?? undefined;
  let expectedPreviousPageKey: string | null =
    cursor?.last_applied_page_key ?? null;
  let stop: StopReason | null = null;

  for (;;) {
    stop = tracker.shouldStop();
    if (stop) break;

    const whereClause = buildCatalogueWhereClause({
      profile,
      gameTypes,
      nowUnixSeconds: now,
      afterIgdbId: lastIgdbId,
    });
    const query = buildCatalogueScanQuery({
      whereClause,
      sort: "id asc",
      limit: scanPageSize,
    });
    const page = await igdbFetch<Parameters<typeof toScanCandidate>[0]>(
      tracker,
      "games",
      query,
    );

    if (page.length === 0) {
      const completePage: RpcPage = {
        cursorName,
        candidates: [],
        markIneligible: [],
        newLastIgdbId: lastIgdbId ?? 0,
        newLastUpdatedAtUnix: null,
        newLastUpdatedAtIgdbId: null,
        newLastReleaseCheckUnix: null,
        newLastReleaseCheckIgdbId: null,
        markCompleted: true,
      };
      if (execute && lease) {
        const applied = await applyPage(
          lease,
          expectedPreviousPageKey,
          completePage,
        );
        expectedPreviousPageKey = buildCataloguePageKey(completePage);
        console.log(
          `Discovery complete for generation ${generation} (${applied.status}).`,
        );
      } else {
        console.log(
          "[dry-run] Would mark this generation complete (no more candidates).",
        );
      }
      stop = { kind: "exhausted" };
      break;
    }

    const candidates = page
      .filter((g) => isEligibleForCatalogue(toScanCandidate(g), profile, now))
      .map((g) => ({
        igdbId: g.id,
        profile,
        igdbUpdatedAtUnix: g.updated_at ?? now,
      }));
    const pageMaxId = Math.max(...page.map((g) => g.id));

    const rpcPage: RpcPage = {
      cursorName,
      candidates,
      markIneligible: [],
      newLastIgdbId: pageMaxId,
      newLastUpdatedAtUnix: null,
      newLastUpdatedAtIgdbId: null,
      newLastReleaseCheckUnix: null,
      newLastReleaseCheckIgdbId: null,
      markCompleted: false,
    };

    if (execute && lease) {
      const applied = await applyPage(lease, expectedPreviousPageKey, rpcPage);
      expectedPreviousPageKey = buildCataloguePageKey(rpcPage);
      console.log(
        `Page (id > ${lastIgdbId ?? 0}): ${page.length} scanned, ${candidates.length} eligible, ${applied.candidatesEncountered} encountered, ${applied.newLedgerRows} new (${applied.status})`,
      );
    } else {
      console.log(
        `[dry-run] Page (id > ${lastIgdbId ?? 0}): ${page.length} scanned, ${candidates.length} would be eligible candidates`,
      );
    }

    lastIgdbId = pageMaxId;
    tracker.itemsProcessed += candidates.length;
  }

  return stop;
}

async function currentGeneration(
  profile: CatalogueProfileName,
): Promise<number> {
  const { data } = await admin
    .from("igdb_catalogue_discovery_cursor")
    .select("cursor_name")
    .like("cursor_name", `discover:${profile}:gen%`)
    .order("cursor_name", { ascending: false })
    .limit(1);
  const latest = data?.[0]?.cursor_name;
  if (!latest) return 1;
  const match = /:gen(\d+)$/.exec(latest);
  return match ? Number(match[1]) : 1;
}

async function nextGeneration(profile: CatalogueProfileName): Promise<number> {
  return (await currentGeneration(profile)) + 1;
}

// --- incremental -------------------------------------------------------

async function runIncremental(
  profile: CatalogueProfileName,
  tracker: RunTracker,
  lease: CatalogueLease | null,
) {
  const cursorName = `incremental:${profile}`;
  const cursor = await readCursor(cursorName);
  const scanStartedAt = Math.floor(Date.now() / 1000);
  const now = scanStartedAt;

  let watermarkUnix = cursor?.last_updated_at
    ? Math.floor(new Date(cursor.last_updated_at).getTime() / 1000)
    : 0;
  let watermarkIgdbId = cursor?.last_updated_at_igdb_id ?? 0;
  let expectedPreviousPageKey: string | null =
    cursor?.last_applied_page_key ?? null;
  let stop: StopReason | null = null;

  for (;;) {
    stop = tracker.shouldStop();
    if (stop) break;

    const whereClause = buildIncrementalWhereClause({
      afterUpdatedAtUnix: watermarkUnix,
      tieBreakIgdbId: watermarkIgdbId,
    });
    const query = buildCatalogueScanQuery({
      whereClause,
      sort: "updated_at asc, id asc",
      limit: scanPageSize,
    });
    const page = await igdbFetch<
      Parameters<typeof toScanCandidate>[0] & { updated_at?: number }
    >(tracker, "games", query);

    if (page.length === 0) {
      stop = { kind: "exhausted" };
      break;
    }

    const eligible: {
      igdbId: number;
      profile: string;
      igdbUpdatedAtUnix: number;
    }[] = [];
    const ineligible: number[] = [];
    for (const g of page) {
      if (isEligibleForCatalogue(toScanCandidate(g), profile, now)) {
        eligible.push({
          igdbId: g.id,
          profile,
          igdbUpdatedAtUnix: g.updated_at ?? now,
        });
      } else {
        ineligible.push(g.id);
      }
    }

    const lastRow = page[page.length - 1]!;
    const rawNewWatermarkUnix = lastRow.updated_at ?? watermarkUnix;
    // Safety overlap window: never advance past (scanStartedAt - overlap),
    // even if this page's last row is more recent than that.
    const cappedWatermarkUnix = Math.min(
      rawNewWatermarkUnix,
      scanStartedAt - INCREMENTAL_OVERLAP_SECONDS,
    );

    const rpcPage: RpcPage = {
      cursorName,
      candidates: eligible,
      markIneligible: ineligible,
      newLastIgdbId: null,
      newLastUpdatedAtUnix: cappedWatermarkUnix,
      newLastUpdatedAtIgdbId: lastRow.id,
      newLastReleaseCheckUnix: null,
      newLastReleaseCheckIgdbId: null,
      markCompleted: false,
    };

    if (execute && lease) {
      const applied = await applyPage(lease, expectedPreviousPageKey, rpcPage);
      expectedPreviousPageKey = buildCataloguePageKey(rpcPage);
      console.log(
        `Page (updated_at > ${watermarkUnix}): ${page.length} scanned, ${eligible.length} eligible, ${ineligible.length} now-ineligible, ${applied.candidatesEncountered} encountered (${applied.status})`,
      );
    } else {
      console.log(
        `[dry-run] Page (updated_at > ${watermarkUnix}): ${page.length} scanned, ${eligible.length} would be eligible, ${ineligible.length} would be marked ineligible`,
      );
    }

    watermarkUnix = cappedWatermarkUnix;
    watermarkIgdbId = lastRow.id;
    tracker.itemsProcessed += eligible.length;

    // The watermark can't outrun the overlap boundary — if this page's
    // rows are already past it, further pages this run would be too.
    if (rawNewWatermarkUnix >= scanStartedAt - INCREMENTAL_OVERLAP_SECONDS) {
      stop = { kind: "exhausted" };
      break;
    }
  }

  return stop;
}

// --- release-check -------------------------------------------------------

async function runReleaseCheck(
  profile: CatalogueProfileName,
  tracker: RunTracker,
  lease: CatalogueLease | null,
) {
  const cursorName = `release-check:${profile}`;
  const cursor = await readCursor(cursorName);
  if (!cursor?.last_release_check) {
    console.error(
      `release-check has no seeded watermark for profile "${profile}" — run \`discover --profile ${profile}\` first (it seeds this automatically on generation 1).`,
    );
    process.exitCode = 1;
    return { kind: "exhausted" } satisfies StopReason;
  }

  const gameTypes = await resolveGameTypes(tracker);
  const scanStartedAt = Math.floor(Date.now() / 1000);
  const now = scanStartedAt;

  let watermarkUnix = Math.floor(
    new Date(cursor.last_release_check).getTime() / 1000,
  );
  let watermarkIgdbId = cursor.last_release_check_igdb_id ?? 0;
  let expectedPreviousPageKey: string | null =
    cursor.last_applied_page_key ?? null;
  let stop: StopReason | null = null;

  for (;;) {
    stop = tracker.shouldStop();
    if (stop) break;

    const whereClause = buildReleaseCheckWhereClause({
      profile,
      gameTypes,
      afterReleaseDateUnix: watermarkUnix,
      tieBreakIgdbId: watermarkIgdbId,
      nowUnixSeconds: now,
    });
    const query = buildCatalogueScanQuery({
      whereClause,
      sort: "first_release_date asc, id asc",
      limit: scanPageSize,
    });
    const page = await igdbFetch<Parameters<typeof toScanCandidate>[0]>(
      tracker,
      "games",
      query,
    );

    if (page.length === 0) {
      stop = { kind: "exhausted" };
      break;
    }

    const candidates = page.map((g) => ({
      igdbId: g.id,
      profile,
      igdbUpdatedAtUnix: g.updated_at ?? now,
    }));
    const lastRow = page[page.length - 1]!;
    const rawNewWatermarkUnix = lastRow.first_release_date ?? watermarkUnix;
    const cappedWatermarkUnix = Math.min(
      rawNewWatermarkUnix,
      scanStartedAt - INCREMENTAL_OVERLAP_SECONDS,
    );

    const rpcPage: RpcPage = {
      cursorName,
      candidates,
      markIneligible: [],
      newLastIgdbId: null,
      newLastUpdatedAtUnix: null,
      newLastUpdatedAtIgdbId: null,
      newLastReleaseCheckUnix: cappedWatermarkUnix,
      newLastReleaseCheckIgdbId: lastRow.id,
      markCompleted: false,
    };

    if (execute && lease) {
      const applied = await applyPage(lease, expectedPreviousPageKey, rpcPage);
      expectedPreviousPageKey = buildCataloguePageKey(rpcPage);
      console.log(
        `Page (release_date > ${watermarkUnix}): ${page.length} newly-released candidates, ${applied.candidatesEncountered} encountered (${applied.status})`,
      );
    } else {
      console.log(
        `[dry-run] Page (release_date > ${watermarkUnix}): ${page.length} newly-released candidates`,
      );
    }

    watermarkUnix = cappedWatermarkUnix;
    watermarkIgdbId = lastRow.id;
    tracker.itemsProcessed += candidates.length;

    if (rawNewWatermarkUnix >= scanStartedAt - INCREMENTAL_OVERLAP_SECONDS) {
      stop = { kind: "exhausted" };
      break;
    }
  }

  return stop;
}

// --- sync (per-record embed + Pinecone upsert) ---------------------------

interface SyncCandidateRow {
  igdb_id: number;
  status: string;
  attempt_count: number;
  last_attempted_at: string | null;
}

async function fetchSyncCandidates(limit: number): Promise<SyncCandidateRow[]> {
  const { data, error } = await admin
    .from("igdb_catalogue_sync")
    .select("igdb_id, status, attempt_count, last_attempted_at")
    .in("status", ["pending", "failed"])
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error)
    throw new Error(
      `Failed to fetch sync candidates: ${sanitizeErrorForStorage(error)}`,
    );
  return data ?? [];
}

async function claimSyncRow(row: SyncCandidateRow): Promise<{
  igdbId: number;
  attemptCount: number;
  claimTimestamp: string;
} | null> {
  const claimTimestamp = new Date().toISOString();
  const attemptCount = row.attempt_count + 1;
  const { data } = await admin
    .from("igdb_catalogue_sync")
    .update({
      attempt_count: attemptCount,
      status: "pending",
      last_attempted_at: claimTimestamp,
    })
    .eq("igdb_id", row.igdb_id)
    .eq("attempt_count", row.attempt_count)
    .select("igdb_id");
  if (!data || data.length === 0) return null;
  return { igdbId: row.igdb_id, attemptCount, claimTimestamp };
}

async function finalizeSyncRow(
  claimed: { igdbId: number; attemptCount: number; claimTimestamp: string },
  outcome: { status: "synced" } | { status: "failed"; error: string },
) {
  const payload =
    outcome.status === "synced"
      ? {
          status: "synced",
          last_synced_at: new Date().toISOString(),
          error: null,
        }
      : { status: "failed", error: outcome.error };
  await admin
    .from("igdb_catalogue_sync")
    .update(payload)
    .eq("igdb_id", claimed.igdbId)
    .eq("attempt_count", claimed.attemptCount)
    .eq("last_attempted_at", claimed.claimTimestamp);
}

interface SyncClaim {
  igdbId: number;
  attemptCount: number;
  claimTimestamp: string;
}
type SyncRecord = { id: string; text: string } & GameVectorFields;

// `lease` isn't read directly — `sync`'s per-record protocol reuses the
// existing claim/finalize optimistic lock on igdb_catalogue_sync itself
// (no RPC call, so no lease token to pass), but the lease is still
// acquired and held for the whole command by withLease() below, purely
// for mutual exclusion against discover/incremental/release-check.
//
// This is a thin wrapper supplying real Supabase/IGDB/Pinecone deps to
// runSyncOrchestration() (src/lib/pinecone/sync-orchestrator.ts), which
// owns the actual control flow: an outer loop over IGDB detail-fetch
// windows (up to CATALOGUE_DETAIL_BATCH_LIMIT=200 ids, one real IGDB
// request each) and an inner loop splitting each window's built records
// into BACKFILL_BATCH_SIZE-sized, token-budgeted Pinecone sub-batches —
// decoupled so `sync` no longer fetches only 25 IGDB details per request.
// See that module's own header comment for the full design and why it's
// unit-tested there instead of here (this script is outside npm test's
// scope, matching every other scripts/*.mts operator tool).
async function runSync(tracker: RunTracker, _lease: CatalogueLease | null) {
  const namespace = execute ? await getNamespace() : null;
  const pacer = new EmbedRatePacer();

  return runSyncOrchestration<
    SyncCandidateRow,
    SyncClaim,
    IgdbGameDetailRaw,
    SyncRecord,
    StopReason
  >(tracker, {
    execute,
    detailFetchWindowLimit: CATALOGUE_DETAIL_BATCH_LIMIT,
    pineconeSubBatchSize: BACKFILL_BATCH_SIZE,
    maxRecordsPerUpsert: MAX_RECORDS_PER_UPSERT,

    fetchCandidates: (limit) => fetchSyncCandidates(limit),
    claimRow: (row) => claimSyncRow(row),
    previewClaim: (row) => ({
      igdbId: row.igdb_id,
      attemptCount: row.attempt_count,
      claimTimestamp: row.last_attempted_at ?? new Date().toISOString(),
    }),
    getIgdbId: (claim) => claim.igdbId,

    fetchDetails: async (ids) => {
      const detailQuery = buildCatalogueDetailBatchQuery(ids);
      const details = await igdbFetch<IgdbGameDetailRaw>(
        tracker,
        "games",
        detailQuery,
      );
      return new Map(details.map((d) => [d.id, d]));
    },

    buildRecord: (claim, raw) => {
      const detail = mapIgdbGameToRow(raw);
      const text = buildGameEmbeddingText({
        name: detail.game.name,
        summary: detail.game.summary ?? null,
        storyline: detail.game.storyline ?? null,
        keywords: detail.game.keywords ?? [],
        genres: detail.genres,
        platforms: detail.platforms,
        gameModes: detail.gameModes,
        themes: detail.themes,
      });
      const fields = buildGameRecordFields({
        igdbId: claim.igdbId,
        slug: detail.game.slug,
        name: detail.game.name,
        releaseDate: detail.game.release_date ?? null,
        genres: detail.genres,
        platforms: detail.platforms,
        gameModes: detail.gameModes,
        coverImageId: detail.game.cover_image_id ?? null,
        igdbUpdatedAtUnix: (raw as { updated_at?: number }).updated_at ?? null,
      });
      return {
        record: { id: `igdb-${claim.igdbId}`, text, ...fields },
        charCount: text.length,
      };
    },

    finalizeSynced: (claim) => finalizeSyncRow(claim, { status: "synced" }),
    finalizeFailed: (claim, error) =>
      finalizeSyncRow(claim, { status: "failed", error }),

    upsertBatch: async (records, marginedTokens) => {
      await pacer.waitForCapacity(marginedTokens);
      await namespace!.upsertRecords({ records });
    },

    sanitizeError: (err) => sanitizeErrorForStorage(err),

    exhaustedStop: { kind: "exhausted" },
    ceilingStop: { kind: "ceiling", which: "--max-estimated-embedding-tokens" },

    onLog: (message) => console.log(message),
  });
}

// --- status / verify (read-only, bounded) ---------------------------------

async function runStatus() {
  const maxPages = intFlag("--max-pages") ?? 20;
  const maxRecords = intFlag("--max-records") ?? maxPages * 100;

  const { data: cursors } = await admin
    .from("igdb_catalogue_discovery_cursor")
    .select("*");
  // Four separate exact head-counts, not a single `.select("status")` fetch
  // counted client-side — PostgREST caps a row-returning select at 1000
  // rows by default, which silently undercounted `pending` once the ledger
  // grew past that (found live in Gate E: reported 875 pending against a
  // true 26,551). `head: true` with `count: "exact"` returns only a count
  // header, never subject to that row cap.
  const counts = { pending: 0, synced: 0, failed: 0, ineligible: 0 };
  for (const status of Object.keys(counts) as (keyof typeof counts)[]) {
    const { count } = await admin
      .from("igdb_catalogue_sync")
      .select("igdb_id", { count: "exact", head: true })
      .eq("status", status);
    counts[status] = count ?? 0;
  }
  const { count: ledgerTotal } = await admin
    .from("igdb_catalogue_sync")
    .select("igdb_id", { count: "exact", head: true });
  const { count: legacyCount } = await admin
    .from("game_vector_sync")
    .select("game_id", { count: "exact", head: true })
    .or("schema_version.is.null,schema_version.lt.2");

  console.log("\n=== Catalogue status ===\n");
  console.log("Discovery cursors:");
  for (const c of cursors ?? []) {
    console.log(
      `  ${c.cursor_name}: candidates_discovered=${c.candidates_discovered}, completed_at=${c.completed_at ?? "(in progress)"}`,
    );
  }
  console.log(
    `\nLedger (igdb_catalogue_sync), total ${ledgerTotal ?? "?"} rows:`,
  );
  console.log(
    `  pending=${counts.pending} synced=${counts.synced} failed=${counts.failed} ineligible=${counts.ineligible}`,
  );
  console.log(
    `\ngame_vector_sync rows still on schema v1 (or unversioned): ${legacyCount ?? "?"}`,
  );

  try {
    const namespace = await getNamespace();
    const stats = await namespace.describeIndexStats();
    console.log(
      `\nPinecone index record count (exact, describeIndexStats): ${stats.namespaces?.[PINECONE_NAMESPACE]?.recordCount ?? "unknown"}`,
    );

    let legacyShaped = 0;
    let pagesScanned = 0;
    let recordsScanned = 0;
    let paginationToken: string | undefined;
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    do {
      const listResult = await namespace.listPaginated({ paginationToken });
      pagesScanned += 1;
      for (const v of listResult.vectors ?? []) {
        recordsScanned += 1;
        if (v.id && uuidPattern.test(v.id)) legacyShaped += 1;
      }
      paginationToken = listResult.pagination?.next;
    } while (
      paginationToken &&
      pagesScanned < maxPages &&
      recordsScanned < maxRecords
    );

    const partial = Boolean(paginationToken);
    console.log(
      `Legacy (UUID-shaped) Pinecone records found: ${legacyShaped} out of ${recordsScanned} scanned ` +
        `(${partial ? `PARTIAL — stopped after ${pagesScanned} pages/${recordsScanned} records; true total may be higher` : "complete"})`,
    );
  } catch (err) {
    console.log(
      `\n(Pinecone stats unavailable: ${err instanceof Error ? err.message : "unknown error"})`,
    );
  }

  const { data: lease } = await admin
    .from("igdb_catalogue_lease")
    .select("*")
    .single();
  console.log(
    `\nLease: ${lease?.token ? `HELD by ${lease.holder} (${lease.command}) until ${lease.lease_until}` : "free"}`,
  );

  const totalKnownEligible = ledgerTotal ?? 0;
  const totalSynced = counts.synced;
  console.log(
    totalKnownEligible > 0 && totalKnownEligible === totalSynced
      ? "\nDiscovered-eligible count and synced count RECONCILE — coverage claim is safe."
      : "\nDiscovered-eligible count and synced count do NOT yet reconcile — do not claim full catalogue coverage.",
  );
}

async function runVerify() {
  const sampleSize = intFlag("--sample") ?? 10;
  const { data: syncedRows } = await admin
    .from("igdb_catalogue_sync")
    .select("igdb_id")
    .eq("status", "synced")
    .limit(sampleSize);
  if (!syncedRows || syncedRows.length === 0) {
    console.log("No synced rows to verify yet.");
    return;
  }
  const namespace = await getNamespace();
  const ids = syncedRows.map((r) => `igdb-${r.igdb_id}`);
  const fetched = await namespace.fetch({ ids });
  const found = Object.keys(fetched.records ?? {}).length;
  console.log(`\n=== Catalogue verify (sample of ${syncedRows.length}) ===\n`);
  console.log(
    `Pinecone records found for sampled synced igdb_ids: ${found}/${syncedRows.length}`,
  );
  if (found < syncedRows.length) {
    console.log(
      "⚠ Some synced ledger rows have no matching Pinecone record — investigate before trusting `status`'s coverage claim.",
    );
  }
}

// --- main ------------------------------------------------------------------

async function withLease<T>(
  command: "discover" | "sync" | "incremental" | "release-check",
  fn: (lease: CatalogueLease | null) => Promise<T>,
): Promise<T> {
  if (!execute) return fn(null);
  const lease = await CatalogueLease.acquire(
    admin,
    command,
    `${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "host"}:${process.pid}`,
  );
  try {
    return await fn(lease);
  } finally {
    await lease.release();
  }
}

async function main() {
  installSignalHandlers();

  if (!command) {
    console.error(
      "Usage: igdb-catalogue-sync.mts <discover|incremental|release-check|sync|status|verify> [flags]",
    );
    process.exit(1);
  }

  if (
    ["discover", "incremental", "release-check", "sync"].includes(command) &&
    !profileFlag &&
    command !== "sync"
  ) {
    console.error(
      `--profile is required for ${command} (conservative|balanced|broad).`,
    );
    process.exit(1);
  }
  if (profileFlag && !(profileFlag in CATALOGUE_PROFILES)) {
    console.error(
      `Unknown profile "${profileFlag}". Expected one of: ${Object.keys(CATALOGUE_PROFILES).join(", ")}.`,
    );
    process.exit(1);
  }

  // Mutating commands: --execute requires all four ceilings (enforced by
  // requireCeilings()). Dry-run doesn't require any of them (no mutation
  // happens either way), but if the operator passes a bare `--limit` for a
  // quick bounded preview, it's still honored — otherwise a dry-run of a
  // 200K+-candidate profile would page through IGDB indefinitely until
  // manually interrupted.
  const isBoundable = command !== "status" && command !== "verify";
  const ceilings = execute
    ? requireCeilings()
    : isBoundable && intFlag("--limit")
      ? {
          limit: intFlag("--limit")!,
          maxRequests: intFlag("--max-requests") ?? Number.POSITIVE_INFINITY,
          maxRuntimeMinutes:
            intFlag("--max-runtime-minutes") ?? Number.POSITIVE_INFINITY,
          maxEstimatedEmbeddingTokens:
            intFlag("--max-estimated-embedding-tokens") ??
            Number.POSITIVE_INFINITY,
        }
      : null;
  const tracker = new RunTracker(ceilings);
  activeTracker = tracker;

  let stop: StopReason | null = null;
  try {
    switch (command) {
      case "discover":
        stop = await withLease("discover", (lease) =>
          runDiscover(profileFlag!, tracker, lease),
        );
        break;
      case "incremental":
        stop = await withLease("incremental", (lease) =>
          runIncremental(profileFlag!, tracker, lease),
        );
        break;
      case "release-check":
        stop = await withLease("release-check", (lease) =>
          runReleaseCheck(profileFlag!, tracker, lease),
        );
        break;
      case "sync":
        stop = await withLease("sync", (lease) => runSync(tracker, lease));
        break;
      case "status":
        await runStatus();
        break;
      case "verify":
        await runVerify();
        break;
      default:
        console.error(`Unknown command "${command}".`);
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof CatalogueLeaseNotAcquiredError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  if (stop) {
    console.log(`\nStopped: ${JSON.stringify(stop)}`);
  }
  const exitCode = sigintReceived
    ? exitCodeForStop({ kind: "interrupted", signal: sigintReceived })
    : exitCodeForStop(stop);
  process.exitCode = exitCode;
}

await main();
