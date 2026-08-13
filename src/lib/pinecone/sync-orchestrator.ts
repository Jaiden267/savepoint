// Deliberately NOT server-only — this is control-flow logic with every
// side effect pushed behind injected `deps` callbacks, no secrets, no
// direct network/Supabase/Pinecone access of its own. That's what makes it
// unit-testable: scripts/igdb-catalogue-sync.mts's `runSync()` supplies
// real deps (Supabase claim/finalize, a real IGDB detail fetch, a real
// Pinecone upsert); tests supply fakes and assert on call order/counts.
//
// This exists to decouple two batch sizes that used to be the same thing:
// how many candidates go into one IGDB detail-fetch request (up to 200,
// IGDB's own per-request id limit) vs. how many go into one Pinecone
// upsert (capped well under Pinecone's MAX_RECORDS_PER_UPSERT and further
// trimmed by the live embedding-token ceiling via selectWithinTokenBudget).
// Before this module existed, both were the same fixed batch size
// (25 = BACKFILL_BATCH_SIZE), so `sync` only ever fetched 25 IGDB details
// per request — correct, but ~8x more IGDB requests than necessary.
import {
  selectWithinTokenBudget,
  type TokenBudgetItem,
} from "./token-budget.ts";

export interface SyncTracker<TStopReason> {
  shouldStop(): TStopReason | null;
  remainingTokenAllowance(): number;
  remainingItemAllowance(): number;
  itemsProcessed: number;
  estimatedTokens: number;
}

export interface BuiltSyncRecord<TClaim, TRecord> extends TokenBudgetItem {
  claim: TClaim;
  record: TRecord;
}

export interface SyncOrchestratorDeps<
  TRow,
  TClaim,
  TRaw,
  TRecord,
  TStopReason,
> {
  execute: boolean;
  /** IGDB's own per-request id ceiling for a detail-batch query (e.g. 200). */
  detailFetchWindowLimit: number;
  /** Records per Pinecone upsert sub-batch (e.g. 25) — independent of detailFetchWindowLimit. */
  pineconeSubBatchSize: number;
  /** Pinecone's own hard per-upsert-call limit — asserted, never silently exceeded. */
  maxRecordsPerUpsert: number;

  fetchCandidates(limit: number): Promise<TRow[]>;
  /** Extracts the igdb_id from a freshly-fetched row, before any claim — used for the per-invocation duplicate guard below. */
  getRowIgdbId(row: TRow): number;
  /** Real Supabase claim (optimistic-lock write) — only called when `execute`. */
  claimRow(row: TRow): Promise<TClaim | null>;
  /** Dry-run preview claim — no write, reuses the row's already-fetched state. */
  previewClaim(row: TRow): TClaim;
  getIgdbId(claim: TClaim): number;

  /** One real IGDB request for up to `detailFetchWindowLimit` ids. */
  fetchDetails(ids: number[]): Promise<Map<number, TRaw>>;
  buildRecord(claim: TClaim, raw: TRaw): { record: TRecord; charCount: number };

  /**
   * Real Supabase finalize writes — only called when `execute`. Return
   * `true` only when the write is CONFIRMED to have affected the row
   * (checked against the database response, not merely "the call didn't
   * throw"). A confirmed-false or thrown-and-caught outcome must never be
   * silently treated as success — see `itemsProcessed`'s doc comment on
   * `SyncTracker` for why this matters: a live incident showed a silently
   * swallowed finalize error let the same igdb_id get claimed and counted
   * twice within one invocation, inflating the tracker's progress count
   * relative to what the ledger and Pinecone actually recorded (see
   * scripts/igdb-catalogue-sync.mts's "sync" section and
   * docs/PINECONE.md's "Gate E final continuation" incident writeup for
   * the full proof).
   */
  finalizeSynced(claim: TClaim): Promise<boolean>;
  finalizeFailed(claim: TClaim, error: string): Promise<boolean>;

  /** Real Pinecone upsert (including any rate-pacer wait) — only called when `execute`. */
  upsertBatch(records: TRecord[], marginedTokens: number): Promise<void>;

  sanitizeError(err: unknown): string;

  exhaustedStop: TStopReason;
  ceilingStop: TStopReason;

  onLog?(message: string): void;
}

/**
 * Distinct progress counters, kept separate on purpose (see the live
 * incident referenced on `finalizeSynced` above): "fetched" and "examined"
 * count raw query/dedup activity; "built"/"upserted" count real external
 * writes attempted; "finalized" counts only CONFIRMED ledger outcomes.
 * `itemsProcessed` (on the tracker, driving `--limit`) is kept exactly
 * equal to `rowsFinalizedSynced + rowsFinalizedFailed` — real, confirmed
 * outcomes only, never a raw fetched/claimed/attempted count.
 */
export interface SyncRunCounters {
  candidatesFetched: number;
  duplicateCandidatesSkipped: number;
  uniqueCandidatesExamined: number;
  recordsBuilt: number;
  recordsUpserted: number;
  rowsFinalizedSynced: number;
  rowsFinalizedFailed: number;
  /** A finalize call that ran but was NOT confirmed to affect a row — a genuine anomaly, always worth surfacing even though the row stays safely `pending`/reclaimable. */
  finalizeUnconfirmed: number;
}

export interface SyncRunResult<TStopReason> {
  stop: TStopReason | null;
  counters: SyncRunCounters;
}

/**
 * Outer loop: one IGDB detail-fetch window (up to `detailFetchWindowLimit`
 * candidates, one real IGDB request) at a time.
 * Inner loop: that window's built records are split into
 * `pineconeSubBatchSize`-sized sub-batches, each independently
 * token-budgeted (a shrinking allowance carried across sub-batches) and
 * upserted — so a single detail-fetch window can safely span many Pinecone
 * calls without ever sending more than `maxRecordsPerUpsert` in one upsert.
 *
 * `tracker.shouldStop()` is checked fresh before the outer fetch AND
 * before every inner sub-batch — the real interruption/ceiling boundary is
 * per sub-batch, not per window, so a signal or an exhausted ceiling can
 * stop mid-window without ever touching the sub-batches after it. Nothing
 * in that untouched tail is ever finalized — those claims stay exactly as
 * the claim step left them (ledger status 'pending', bumped attempt_count),
 * which is what makes them safely, immediately reclaimable by a future run
 * (this table has no staleness gate on top of that, unchanged by this
 * module — see igdb-catalogue-sync.mts's sync section).
 */
export async function runSyncOrchestration<
  TRow,
  TClaim,
  TRaw,
  TRecord,
  TStopReason,
>(
  tracker: SyncTracker<TStopReason>,
  deps: SyncOrchestratorDeps<TRow, TClaim, TRaw, TRecord, TStopReason>,
): Promise<SyncRunResult<TStopReason>> {
  let stop: TStopReason | null = null;
  const counters: SyncRunCounters = {
    candidatesFetched: 0,
    duplicateCandidatesSkipped: 0,
    uniqueCandidatesExamined: 0,
    recordsBuilt: 0,
    recordsUpserted: 0,
    rowsFinalizedSynced: 0,
    rowsFinalizedFailed: 0,
    finalizeUnconfirmed: 0,
  };
  // Per-invocation-only duplicate guard. A row can legitimately resurface
  // in a later fetch window within the SAME invocation — e.g. if an
  // earlier finalize call for it wasn't confirmed (see finalizeSynced's
  // doc comment) and it's still genuinely `pending` — but re-claiming and
  // re-counting it a second time would silently inflate itemsProcessed
  // relative to real, distinct outcomes. This set makes that structurally
  // impossible regardless of the underlying cause: once an igdb_id has
  // been examined this invocation, it is never claimed or counted again
  // here. It stays exactly as its last claim left it (still `pending`,
  // reclaimable) for a *future* invocation to pick up.
  const seenIgdbIds = new Set<number>();

  outer: for (;;) {
    stop = tracker.shouldStop();
    if (stop) break;

    const fetchWindow = Math.min(
      deps.detailFetchWindowLimit,
      tracker.remainingItemAllowance(),
    );
    const candidates = await deps.fetchCandidates(fetchWindow);
    if (candidates.length === 0) {
      stop = deps.exhaustedStop;
      break;
    }
    counters.candidatesFetched += candidates.length;

    const newRows: TRow[] = [];
    for (const row of candidates) {
      const id = deps.getRowIgdbId(row);
      if (seenIgdbIds.has(id)) {
        counters.duplicateCandidatesSkipped += 1;
        continue;
      }
      seenIgdbIds.add(id);
      newRows.push(row);
    }
    counters.uniqueCandidatesExamined += newRows.length;
    if (newRows.length === 0) {
      // Every candidate this window returned has already been examined
      // this invocation — there is nothing new to make progress on.
      // Never loop on this (a naive `continue` here risks spinning
      // indefinitely, especially in dry-run where nothing ever changes
      // state) — end the run cleanly instead, exactly as if the query
      // itself had returned zero rows.
      stop = deps.exhaustedStop;
      break;
    }

    // Claiming (a real Supabase write) is gated behind `execute` so a
    // dry-run never mutates the ledger. In dry-run, `previewClaim` reuses
    // the row's already-fetched state (no attempt_count bump) so batch
    // composition and token estimates still reflect reality.
    const claimed: TClaim[] = [];
    for (const row of newRows) {
      if (deps.execute) {
        const claim = await deps.claimRow(row);
        if (claim) claimed.push(claim);
      } else {
        claimed.push(deps.previewClaim(row));
      }
    }
    if (claimed.length === 0) continue;

    const ids = claimed
      .slice(0, deps.detailFetchWindowLimit)
      .map((c) => deps.getIgdbId(c));
    let detailById: Map<number, TRaw>;
    try {
      detailById = await deps.fetchDetails(ids);
    } catch (err) {
      if (deps.execute) {
        const message = deps.sanitizeError(err);
        let confirmedFailed = 0;
        for (const claim of claimed) {
          if (await deps.finalizeFailed(claim, message)) {
            counters.rowsFinalizedFailed += 1;
            confirmedFailed += 1;
          } else {
            counters.finalizeUnconfirmed += 1;
          }
        }
        tracker.itemsProcessed += confirmedFailed;
      } else {
        tracker.itemsProcessed += claimed.length;
      }
      continue;
    }

    const built: BuiltSyncRecord<TClaim, TRecord>[] = [];
    const buildFailures: TClaim[] = [];
    for (const claim of claimed) {
      const raw = detailById.get(deps.getIgdbId(claim));
      if (!raw) {
        buildFailures.push(claim);
        continue;
      }
      const { record, charCount } = deps.buildRecord(claim, raw);
      built.push({ claim, record, charCount });
    }
    counters.recordsBuilt += built.length;

    if (deps.execute) {
      let confirmedFailed = 0;
      for (const claim of buildFailures) {
        if (
          await deps.finalizeFailed(
            claim,
            "no IGDB detail returned for this id",
          )
        ) {
          counters.rowsFinalizedFailed += 1;
          confirmedFailed += 1;
        } else {
          counters.finalizeUnconfirmed += 1;
        }
      }
      tracker.itemsProcessed += confirmedFailed;
    } else {
      tracker.itemsProcessed += buildFailures.length;
    }
    deps.onLog?.(
      `Window: ${claimed.length} claimed, ${built.length} built, ${buildFailures.length} build failures ` +
        `(1 IGDB request for this window, regardless of how many Pinecone sub-batches follow)`,
    );

    let remainingAllowance = tracker.remainingTokenAllowance();
    for (let i = 0; i < built.length; i += deps.pineconeSubBatchSize) {
      const subStop = tracker.shouldStop();
      if (subStop) {
        stop = subStop;
        break outer;
      }

      const chunk = built.slice(i, i + deps.pineconeSubBatchSize);
      const { selected, trimmed, rawTokens, marginedTokens } =
        selectWithinTokenBudget(chunk, remainingAllowance);
      remainingAllowance = Math.max(0, remainingAllowance - marginedTokens);

      if (selected.length > deps.maxRecordsPerUpsert) {
        throw new Error(
          `Internal invariant violated: sub-batch selected ${selected.length} record(s), exceeding maxRecordsPerUpsert (${deps.maxRecordsPerUpsert}). ` +
            "pineconeSubBatchSize must never exceed maxRecordsPerUpsert.",
        );
      }

      if (trimmed.length > 0) {
        deps.onLog?.(
          `Token ceiling: ${selected.length}/${chunk.length} record(s) fit the remaining --max-estimated-embedding-tokens allowance ` +
            `(raw=${rawTokens} margined=${marginedTokens} tokens); ${trimmed.length} left pending for a future run.`,
        );
      }

      let confirmedThisBatch = 0;
      if (selected.length > 0 && deps.execute) {
        try {
          await deps.upsertBatch(
            selected.map((s) => s.record),
            marginedTokens,
          );
          counters.recordsUpserted += selected.length;
          for (const s of selected) {
            if (await deps.finalizeSynced(s.claim)) {
              counters.rowsFinalizedSynced += 1;
              confirmedThisBatch += 1;
            } else {
              counters.finalizeUnconfirmed += 1;
            }
          }
        } catch (err) {
          const message = deps.sanitizeError(err);
          for (const s of selected) {
            if (await deps.finalizeFailed(s.claim, message)) {
              counters.rowsFinalizedFailed += 1;
              confirmedThisBatch += 1;
            } else {
              counters.finalizeUnconfirmed += 1;
            }
          }
        }
      } else if (selected.length > 0) {
        deps.onLog?.(
          `[dry-run] Would embed + upsert ${selected.length} record(s) (raw=${rawTokens} margined=${marginedTokens} tokens).`,
        );
      }

      tracker.estimatedTokens += marginedTokens;
      // itemsProcessed (drives --limit) reflects CONFIRMED real outcomes
      // only — never a raw fetched/claimed/attempted count. In dry-run,
      // where nothing is ever confirmed (finalize is never called), the
      // selected count is the best available preview estimate instead;
      // dry-run can't suffer the double-count failure mode this guards
      // against, since previewClaim never mutates state.
      tracker.itemsProcessed += deps.execute
        ? confirmedThisBatch
        : selected.length;
      deps.onLog?.(
        `Batch: ${selected.length} synced this batch, ${trimmed.length} deferred by token ceiling`,
      );

      if (trimmed.length > 0) {
        stop = deps.ceilingStop;
        break outer;
      }
    }
  }

  return { stop, counters };
}
