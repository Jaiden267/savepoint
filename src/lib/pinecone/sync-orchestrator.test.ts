import { describe, expect, it, vi } from "vitest";
import { runSyncOrchestration, type SyncTracker } from "./sync-orchestrator.ts";

interface FakeRow {
  igdbId: number;
}
interface FakeClaim {
  igdbId: number;
}
interface FakeRaw {
  igdbId: number;
}
interface FakeRecord {
  igdbId: number;
}
type FakeStop =
  | { kind: "exhausted" }
  | { kind: "ceiling" }
  | { kind: "interrupted" }
  | { kind: "limit_reached" };

/** Mirrors the real script's RunTracker ceiling logic closely enough to exercise the orchestrator honestly, plus an optional hook to force an interruption at a specific shouldStop() call number. */
class FakeTracker implements SyncTracker<FakeStop> {
  itemsProcessed = 0;
  estimatedTokens = 0;
  private shouldStopCalls = 0;
  constructor(
    private readonly limit = Number.POSITIVE_INFINITY,
    private readonly tokenLimit = Number.POSITIVE_INFINITY,
    private readonly interruptOnCall: number | null = null,
  ) {}

  shouldStop(): FakeStop | null {
    this.shouldStopCalls += 1;
    if (
      this.interruptOnCall !== null &&
      this.shouldStopCalls >= this.interruptOnCall
    ) {
      return { kind: "interrupted" };
    }
    if (this.itemsProcessed >= this.limit) return { kind: "limit_reached" };
    if (this.estimatedTokens >= this.tokenLimit) return { kind: "ceiling" };
    return null;
  }

  remainingTokenAllowance(): number {
    return Math.max(0, this.tokenLimit - this.estimatedTokens);
  }

  remainingItemAllowance(): number {
    return Math.max(0, this.limit - this.itemsProcessed);
  }
}

/** A queue-backed fetchCandidates fake: each call drains up to `limit` rows from the front of a shared pool, mimicking the ledger. */
function makeCandidatePool(count: number) {
  const pool: FakeRow[] = Array.from({ length: count }, (_, i) => ({
    igdbId: i + 1,
  }));
  return {
    fetchCandidates: vi.fn(async (limit: number) => pool.splice(0, limit)),
  };
}

interface BaseDepsOverrides {
  execute?: boolean;
  fetchCandidates?: ReturnType<typeof makeCandidatePool>["fetchCandidates"];
  fetchDetails?: (ids: number[]) => Promise<Map<number, FakeRaw>>;
  pineconeSubBatchSize?: number;
  maxRecordsPerUpsert?: number;
}

// Explicit named overrides, not a `Partial<...>` spread-merge — spreading a
// generic Partial over concrete vi.fn() defaults widens every property back
// to its plain call-signature type and loses `.mock`, which every
// assertion below relies on.
function baseDeps(overrides: BaseDepsOverrides = {}) {
  const claimRow = vi.fn(async (row: FakeRow): Promise<FakeClaim | null> => ({
    igdbId: row.igdbId,
  }));
  const previewClaim = vi.fn((row: FakeRow): FakeClaim => ({
    igdbId: row.igdbId,
  }));
  const fetchDetails =
    overrides.fetchDetails ??
    vi.fn(async (ids: number[]) => {
      const map = new Map<number, FakeRaw>();
      for (const id of ids) map.set(id, { igdbId: id });
      return map;
    });
  const buildRecord = vi.fn((claim: FakeClaim, _raw: FakeRaw) => ({
    record: { igdbId: claim.igdbId } as FakeRecord,
    charCount: 40, // -> 10 raw tokens, 13 margined tokens per record at the real 1.3x multiplier
  }));
  const finalizeSynced = vi.fn(async (_claim: FakeClaim) => {});
  const finalizeFailed = vi.fn(async (_claim: FakeClaim, _error: string) => {});
  const upsertBatch = vi.fn(
    async (_records: FakeRecord[], _marginedTokens: number) => {},
  );
  const fetchCandidates =
    overrides.fetchCandidates ?? makeCandidatePool(0).fetchCandidates;

  return {
    execute: overrides.execute ?? true,
    detailFetchWindowLimit: 200,
    pineconeSubBatchSize: overrides.pineconeSubBatchSize ?? 25,
    maxRecordsPerUpsert: overrides.maxRecordsPerUpsert ?? 96,
    fetchCandidates,
    claimRow,
    previewClaim,
    getIgdbId: (c: FakeClaim) => c.igdbId,
    fetchDetails,
    buildRecord,
    finalizeSynced,
    finalizeFailed,
    upsertBatch,
    sanitizeError: (err: unknown) =>
      err instanceof Error ? err.message : "unknown",
    exhaustedStop: { kind: "exhausted" } as FakeStop,
    ceilingStop: { kind: "ceiling" } as FakeStop,
  };
}

describe("runSyncOrchestration", () => {
  it("splits a 200-id detail-fetch window into 8 Pinecone sub-batches of 25 from a single IGDB request", async () => {
    const { fetchCandidates } = makeCandidatePool(200);
    const tracker = new FakeTracker();
    const deps = baseDeps({ fetchCandidates });

    const stop = await runSyncOrchestration(tracker, deps);

    expect(deps.fetchDetails).toHaveBeenCalledTimes(1); // one IGDB request for the whole 200-id window
    expect(deps.upsertBatch).toHaveBeenCalledTimes(8); // 200 / 25
    for (const call of deps.upsertBatch.mock.calls) {
      expect(call[0]).toHaveLength(25);
    }
    expect(stop).toEqual({ kind: "exhausted" });
    expect(tracker.itemsProcessed).toBe(200);
  });

  it("handles a partial final fetch window and a partial final sub-batch", async () => {
    const { fetchCandidates } = makeCandidatePool(210);
    const tracker = new FakeTracker();
    const deps = baseDeps({ fetchCandidates });

    await runSyncOrchestration(tracker, deps);

    // windows: 200, then 10 (partial), then empty -> exhausted
    expect(deps.fetchDetails).toHaveBeenCalledTimes(2);
    expect(deps.upsertBatch).toHaveBeenCalledTimes(9); // 8 full + 1 partial
    const lastCall = deps.upsertBatch.mock.calls.at(-1)!;
    expect(lastCall[0]).toHaveLength(10);
    expect(tracker.itemsProcessed).toBe(210);
  });

  it("routes missing IGDB detail responses to finalizeFailed without touching found records", async () => {
    const { fetchCandidates } = makeCandidatePool(10);
    const tracker = new FakeTracker();
    const fetchDetails = vi.fn(async (ids: number[]) => {
      const map = new Map<number, FakeRaw>();
      // Only the first 7 of 10 claimed ids have a detail response — the
      // other 3 are "missing/ineligible" (delisted, malformed, etc.).
      for (const id of ids.slice(0, 7)) map.set(id, { igdbId: id });
      return map;
    });
    const deps = baseDeps({ fetchCandidates, fetchDetails });

    await runSyncOrchestration(tracker, deps);

    expect(deps.finalizeFailed).toHaveBeenCalledTimes(3);
    for (const call of deps.finalizeFailed.mock.calls) {
      expect(call[1]).toBe("no IGDB detail returned for this id");
    }
    expect(deps.upsertBatch).toHaveBeenCalledTimes(1);
    expect(deps.upsertBatch.mock.calls[0]![0]).toHaveLength(7);
    expect(deps.finalizeSynced).toHaveBeenCalledTimes(7);
    expect(tracker.itemsProcessed).toBe(10); // 3 build failures + 7 synced
  });

  it("stops cleanly mid-window on interruption, leaving later sub-batches' claims unfinalized and reclaimable", async () => {
    const { fetchCandidates } = makeCandidatePool(100); // one window, 4 sub-batches of 25
    // shouldStop() call sequence: [1]=outer-start, [2]=sub-batch-1, [3]=sub-batch-2, [4]=sub-batch-3.
    // Interrupt starting at call 4 -> sub-batches 1 and 2 complete, 3 and 4 never run.
    const tracker = new FakeTracker(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      4,
    );
    const deps = baseDeps({ fetchCandidates });

    const stop = await runSyncOrchestration(tracker, deps);

    expect(stop).toEqual({ kind: "interrupted" });
    // All 100 rows were claimed up front (claim happens before the interruption
    // check can fire) — but only 2 of 4 sub-batches (50 records) were ever
    // finalized. The other 50 claims are left exactly as claimRow wrote them:
    // never finalized, so in the real ledger they stay 'pending' and are
    // immediately reclaimable by the next run (no staleness gate on that table).
    expect(deps.claimRow).toHaveBeenCalledTimes(100);
    expect(deps.upsertBatch).toHaveBeenCalledTimes(2);
    expect(deps.finalizeSynced).toHaveBeenCalledTimes(50);
    expect(deps.finalizeFailed).not.toHaveBeenCalled();
    expect(tracker.itemsProcessed).toBe(50);
  });

  it("makes exactly one IGDB request per detail-fetch window regardless of how many Pinecone sub-batches follow", async () => {
    const { fetchCandidates } = makeCandidatePool(350);
    const tracker = new FakeTracker();
    const deps = baseDeps({ fetchCandidates });

    await runSyncOrchestration(tracker, deps);

    // windows: 200, 150, then empty -> exhausted. 14 sub-batches (8 + 6) but
    // only 2 real IGDB requests — this is the whole point of decoupling.
    expect(deps.fetchDetails).toHaveBeenCalledTimes(2);
    expect(deps.upsertBatch).toHaveBeenCalledTimes(14);
    expect(tracker.itemsProcessed).toBe(350);
  });

  it("enforces the record ceiling exactly, sizing the fetch window to the remaining --limit allowance", async () => {
    const { fetchCandidates } = makeCandidatePool(200);
    const tracker = new FakeTracker(30); // --limit 30, far below the 200-id detail window cap
    const deps = baseDeps({ fetchCandidates });

    const stop = await runSyncOrchestration(tracker, deps);

    expect(fetchCandidates).toHaveBeenCalledWith(30); // min(200, remaining 30), not 200
    expect(tracker.itemsProcessed).toBe(30); // never overshoots --limit
    expect(stop).toEqual({ kind: "limit_reached" });
  });

  it("writes nothing to the ledger during a dry-run, even on a missing-detail response and a token-ceiling trim", async () => {
    const { fetchCandidates } = makeCandidatePool(60);
    // Tiny token allowance so a real trim occurs — charCount 40 -> 13 margined
    // tokens/record; allowance 100 fits ~7 records before trimming.
    const tracker = new FakeTracker(Number.POSITIVE_INFINITY, 100);
    const fetchDetails = vi.fn(async (ids: number[]) => {
      const map = new Map<number, FakeRaw>();
      for (const id of ids.slice(0, ids.length - 2))
        map.set(id, { igdbId: id }); // 2 missing
      return map;
    });
    const deps = baseDeps({ execute: false, fetchCandidates, fetchDetails });

    await runSyncOrchestration(tracker, deps);

    expect(deps.claimRow).not.toHaveBeenCalled();
    expect(deps.previewClaim).toHaveBeenCalled();
    expect(deps.finalizeSynced).not.toHaveBeenCalled();
    expect(deps.finalizeFailed).not.toHaveBeenCalled();
    expect(deps.upsertBatch).not.toHaveBeenCalled();
  });

  it("throws rather than silently truncating if a sub-batch ever selects more than maxRecordsPerUpsert", async () => {
    const { fetchCandidates } = makeCandidatePool(50);
    const tracker = new FakeTracker();
    // Misconfigured on purpose: sub-batch size exceeds the Pinecone hard cap.
    const deps = baseDeps({
      fetchCandidates,
      pineconeSubBatchSize: 50,
      maxRecordsPerUpsert: 25,
    });

    await expect(runSyncOrchestration(tracker, deps)).rejects.toThrow(
      /Internal invariant violated/,
    );
  });

  it("carries a shrinking token allowance across sub-batches within one window, stopping the run at the ceiling", async () => {
    const { fetchCandidates } = makeCandidatePool(100);
    // charCount 40 -> 13 margined tokens/record. Allowance 130 fits exactly
    // 10 records before the 11th would push over -> trims partway through
    // sub-batch 1 (25-record chunk), which should end the whole run.
    const tracker = new FakeTracker(Number.POSITIVE_INFINITY, 130);
    const deps = baseDeps({ fetchCandidates });

    const stop = await runSyncOrchestration(tracker, deps);

    expect(stop).toEqual({ kind: "ceiling" });
    expect(deps.upsertBatch).toHaveBeenCalledTimes(1);
    expect(deps.upsertBatch.mock.calls[0]![0].length).toBeLessThan(25);
    expect(deps.upsertBatch.mock.calls[0]![0].length).toBeGreaterThan(0);
  });
});
