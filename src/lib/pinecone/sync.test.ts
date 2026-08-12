import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAdminFrom,
  mockEnsureConfiguredIndex,
  mockGetGameTaggedRefs,
  mockUpsertRecords,
  mockSanitizeError,
} = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockEnsureConfiguredIndex: vi.fn(),
  mockGetGameTaggedRefs: vi.fn(),
  mockUpsertRecords: vi.fn(),
  mockSanitizeError: vi.fn(() => "sanitized-error"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/server/services/game-refs", () => ({
  getGameTaggedRefs: mockGetGameTaggedRefs,
}));

vi.mock("./error-sanitizer", () => ({
  sanitizeErrorForStorage: mockSanitizeError,
}));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, ensureConfiguredIndex: mockEnsureConfiguredIndex };
});

import { syncGameVector } from "./sync";
import {
  PineconeIndexNotBootstrappedError,
  PineconeIndexIncompatibleError,
} from "./client";
import {
  SYNC_LEASE_MS,
  RETRY_COOLDOWN_MS,
  PINECONE_SCHEMA_VERSION,
} from "./constants";

interface GameVectorSyncRow {
  status: string;
  attempt_count: number;
  last_attempted_at: string | null;
  schema_version: number | null;
}

/** Every chain method resolves to (or returns something that resolves to) `result` — mirrors src/server/services/game-sync.test.ts's createTableMock convention. */
function createTableChain(result: { data?: unknown; error?: unknown }) {
  const resolved = { data: null, error: null, ...result };
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(resolved)),
    maybeSingle: vi.fn(() => Promise.resolve(resolved)),
    then: (
      resolve: (v: typeof resolved) => void,
      reject?: (e: unknown) => void,
    ) => Promise.resolve(resolved).then(resolve, reject),
  };
  return chain;
}

/** Configures mockAdminFrom to hand out a queued sequence of chains per table — each successive `.from(table)` call consumes the next queued result. */
function setupAdminFromQueues(
  queues: Record<string, Array<{ data?: unknown; error?: unknown }>>,
) {
  const cursors: Record<string, number> = {};
  const chainsByTable: Record<string, ReturnType<typeof createTableChain>[]> =
    {};
  for (const [table, results] of Object.entries(queues)) {
    chainsByTable[table] = results.map((r) => createTableChain(r));
    cursors[table] = 0;
  }
  mockAdminFrom.mockImplementation((table: string) => {
    const list = chainsByTable[table];
    if (!list)
      throw new Error(`unexpected table "${table}" — no queue configured`);
    const idx = cursors[table]!;
    cursors[table] = idx + 1;
    const chain = list[idx];
    if (!chain) {
      throw new Error(
        `table "${table}" called more times than queued (call #${idx + 1})`,
      );
    }
    return chain;
  });
  return chainsByTable;
}

const GAME_ID = "game-uuid-1";
const GAME_ROW = {
  id: GAME_ID,
  igdb_id: 42,
  slug: "test-game",
  name: "Test Game",
  summary: "A summary.",
  storyline: null,
  release_date: null,
  cover_image_id: null,
  keywords: [],
};
const EMPTY_REFS = { genres: [], platforms: [], gameModes: [], themes: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGameTaggedRefs.mockResolvedValue(EMPTY_REFS);
  mockEnsureConfiguredIndex.mockResolvedValue({
    upsertRecords: mockUpsertRecords,
  });
  mockUpsertRecords.mockResolvedValue(undefined);
  mockSanitizeError.mockReturnValue("sanitized-error");
});

function vectorSyncRow(overrides: Partial<GameVectorSyncRow>): {
  data: GameVectorSyncRow;
} {
  return {
    data: {
      status: "pending",
      attempt_count: 0,
      last_attempted_at: null,
      // Defaults to the current schema version so every pre-existing test
      // below (none of which are about schema versioning) keeps testing
      // exactly what it always tested — see the dedicated
      // "schema-version-aware re-sync" describe block for the new
      // dimension this field adds.
      schema_version: PINECONE_SCHEMA_VERSION,
      ...overrides,
    },
  };
}

describe("syncGameVector — short-circuits (no claim, no Pinecone call)", () => {
  it("already-synced games return skipped_already_synced with zero further calls", async () => {
    setupAdminFromQueues({
      game_vector_sync: [vectorSyncRow({ status: "synced", attempt_count: 3 })],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "skipped_already_synced" });
    expect(mockEnsureConfiguredIndex).not.toHaveBeenCalled();
    expect(mockUpsertRecords).not.toHaveBeenCalled();
  });

  it("retry-exhausted failed rows return skipped_retry_exhausted with zero Pinecone/claim calls", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "failed",
          attempt_count: 5,
          last_attempted_at: new Date(
            Date.now() - RETRY_COOLDOWN_MS * 2,
          ).toISOString(),
        }),
      ],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "skipped_retry_exhausted" });
    expect(mockEnsureConfiguredIndex).not.toHaveBeenCalled();
  });

  it("a failed row inside RETRY_COOLDOWN_MS returns skipped_cooldown without claiming", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "failed",
          attempt_count: 1,
          last_attempted_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      ],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "skipped_cooldown" });
    expect(mockEnsureConfiguredIndex).not.toHaveBeenCalled();
  });
});

describe("syncGameVector — lease behaviour", () => {
  it("a second worker arriving after the first has claimed but before it finishes returns skipped_concurrent with zero Pinecone calls", async () => {
    // Row shows exactly what worker A's claim just wrote: status "pending"
    // with a fresh last_attempted_at — the active-lease signal.
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 1,
          last_attempted_at: new Date(Date.now() - 5_000).toISOString(),
        }),
      ],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "skipped_concurrent" });
    expect(mockEnsureConfiguredIndex).not.toHaveBeenCalled();
    expect(mockUpsertRecords).not.toHaveBeenCalled();
  });

  it("recovers after an expired lease — proceeds to claim and sync", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 1,
          last_attempted_at: new Date(
            Date.now() - SYNC_LEASE_MS - 10_000,
          ).toISOString(),
        }),
        { data: [{ game_id: GAME_ID }] }, // claim succeeds
        { data: null }, // finalize write
      ],
      games: [{ data: GAME_ROW }],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "synced" });
    expect(mockUpsertRecords).toHaveBeenCalledTimes(1);
  });

  it("a freshly re-imported game (last_attempted_at reset to null) is immediately claimable", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 3,
          last_attempted_at: null,
        }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: GAME_ROW }],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "synced" });
  });

  it("an older worker's finalize write is guarded by both the claimed attempt_count and the exact claim timestamp — so a newer claim can never be clobbered", async () => {
    const chains = setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
        }),
        { data: [{ game_id: GAME_ID }] }, // claim
        { data: [] }, // finalize — simulates zero rows affected (a newer worker already moved the row)
      ],
      games: [{ data: GAME_ROW }],
    });

    await expect(syncGameVector(GAME_ID)).resolves.toEqual({
      status: "synced",
    });

    const claimChain = chains.game_vector_sync[1]!;
    const finalizeChain = chains.game_vector_sync[2]!;

    const claimUpdateArg = (claimChain.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { attempt_count: number; last_attempted_at: string };
    const finalizeEqCalls = (finalizeChain.eq as ReturnType<typeof vi.fn>).mock
      .calls as [string, unknown][];

    expect(finalizeEqCalls).toContainEqual([
      "attempt_count",
      claimUpdateArg.attempt_count,
    ]);
    expect(finalizeEqCalls).toContainEqual([
      "last_attempted_at",
      claimUpdateArg.last_attempted_at,
    ]);
  });

  it("a lost claim race returns skipped_concurrent and never calls Pinecone", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
        }),
        { data: [] }, // claim affected zero rows — another worker won
      ],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "skipped_concurrent" });
    expect(mockUpsertRecords).not.toHaveBeenCalled();
  });
});

describe("syncGameVector — schema-version-aware re-sync (Prompt 7C)", () => {
  it("re-syncs (does not skip) a 'synced' row with no schema_version — a legacy v1 record self-healing on next touch", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "synced",
          attempt_count: 4,
          schema_version: null,
        }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: GAME_ROW }],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "synced" });
    expect(mockUpsertRecords).toHaveBeenCalledTimes(1);
  });

  it("re-syncs a 'synced' row whose schema_version is older than the current constant", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "synced",
          attempt_count: 4,
          schema_version: 1,
        }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: GAME_ROW }],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "synced" });
    expect(mockUpsertRecords).toHaveBeenCalledTimes(1);
  });

  it("still skips a 'synced' row whose schema_version already matches the current constant", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "synced",
          schema_version: PINECONE_SCHEMA_VERSION,
        }),
      ],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "skipped_already_synced" });
    expect(mockUpsertRecords).not.toHaveBeenCalled();
  });

  it("stamps schema_version on the finalize write for a successful sync", async () => {
    const chains = setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 0,
          schema_version: null,
        }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: GAME_ROW }],
    });

    await syncGameVector(GAME_ID);

    const finalizeChain = chains.game_vector_sync[2]!;
    const payload = (finalizeChain.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { schema_version: number };
    expect(payload.schema_version).toBe(PINECONE_SCHEMA_VERSION);
  });

  it("upserts under the v2 record id scheme (igdb-${igdbId}), never the raw Supabase UUID", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({ status: "pending", attempt_count: 0 }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: GAME_ROW }],
    });

    await syncGameVector(GAME_ID);

    const upsertArg = mockUpsertRecords.mock.calls[0]![0] as {
      records: { id: string }[];
    };
    expect(upsertArg.records[0]!.id).toBe(`igdb-${GAME_ROW.igdb_id}`);
    expect(upsertArg.records[0]!.id).not.toBe(GAME_ID);
  });
});

describe("syncGameVector — global config failures never consume the per-game retry budget", () => {
  it("a not-bootstrapped index returns deferred without claiming or writing failed", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
        }),
      ],
    });
    mockEnsureConfiguredIndex.mockRejectedValue(
      new PineconeIndexNotBootstrappedError(),
    );

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome.status).toBe("deferred");
    // Only the initial read happened — no claim/update call was made.
    expect(mockAdminFrom).toHaveBeenCalledTimes(1);
  });

  it("an incompatible index returns deferred without claiming or writing failed", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
        }),
      ],
    });
    mockEnsureConfiguredIndex.mockRejectedValue(
      new PineconeIndexIncompatibleError("wrong model"),
    );

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "deferred", reason: "wrong model" });
    expect(mockAdminFrom).toHaveBeenCalledTimes(1);
  });
});

describe("syncGameVector — success and failure paths", () => {
  it("marks the row synced on a successful upsert", async () => {
    const chains = setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
        }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: GAME_ROW }],
    });

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "synced" });
    const finalizeChain = chains.game_vector_sync[2]!;
    const payload = (finalizeChain.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { status: string; error: unknown };
    expect(payload.status).toBe("synced");
    expect(payload.error).toBeNull();
  });

  it("marks the row failed with a sanitized error and an incremented attempt_count when the upsert throws — never marking it synced", async () => {
    const chains = setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 2,
          last_attempted_at: null,
        }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: GAME_ROW }],
    });
    mockUpsertRecords.mockRejectedValue(new Error("boom"));

    const outcome = await syncGameVector(GAME_ID);

    expect(outcome).toEqual({ status: "failed", error: "sanitized-error" });
    const claimChain = chains.game_vector_sync[1]!;
    const claimArg = (claimChain.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { attempt_count: number };
    expect(claimArg.attempt_count).toBe(3);
    const finalizeChain = chains.game_vector_sync[2]!;
    const finalizeArg = (finalizeChain.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { status: string };
    expect(finalizeArg.status).toBe("failed");
  });

  it("never throws even when every downstream call fails", async () => {
    setupAdminFromQueues({
      game_vector_sync: [
        vectorSyncRow({
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
        }),
        { data: [{ game_id: GAME_ID }] },
        { data: null },
      ],
      games: [{ data: null, error: new Error("db down") }],
    });

    await expect(syncGameVector(GAME_ID)).resolves.toMatchObject({
      status: "failed",
    });
  });
});
