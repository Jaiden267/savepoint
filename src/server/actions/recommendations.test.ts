import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

const {
  mockGetUser,
  mockMaybeSingle,
  mockEq,
  mockSelect,
  mockInsert,
  mockDelete,
  mockFrom,
  mockRecordClick,
  mockInvalidateCacheByPrefix,
  mockGetClientIdentifier,
  mockCheckCatalogueImportRateLimit,
  mockImportGameByIgdbId,
  mockSyncGameVector,
  mockRedirect,
} = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  // A single self-referencing chain — every chainable method (select/eq/
  // in/gte) returns the same object, terminating at maybeSingle(). This
  // correctly handles both the 3x-chained .eq().eq().eq() existing-row
  // check and the 1x-chained .eq() game-id lookup with one mock, since
  // real call-count/order never matters to a chain that always returns
  // itself.
  const chain: {
    select: () => typeof chain;
    eq: () => typeof chain;
    in: () => typeof chain;
    gte: () => typeof chain;
    maybeSingle: typeof mockMaybeSingle;
  } = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    gte: () => chain,
    maybeSingle: mockMaybeSingle,
  };
  const mockSelect = vi.fn(() => chain);
  const mockEq = chain.eq;
  const mockInsert = vi.fn(
    (): Promise<{ error: { code?: string; message?: string } | null }> =>
      Promise.resolve({ error: null }),
  );
  const mockDeleteEq = vi.fn(() => Promise.resolve({ error: null }));
  const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
  const mockFrom = vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  }));
  return {
    mockGetUser: vi.fn(),
    mockMaybeSingle,
    mockEq,
    mockSelect,
    mockInsert,
    mockDelete,
    mockFrom,
    mockRecordClick: vi.fn(),
    mockInvalidateCacheByPrefix: vi.fn(),
    mockGetClientIdentifier: vi.fn(),
    mockCheckCatalogueImportRateLimit: vi.fn(),
    mockImportGameByIgdbId: vi.fn(),
    mockSyncGameVector: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    }),
  ),
}));
vi.mock("@/server/services/recommendations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/recommendations")>();
  return { ...actual, recordClick: mockRecordClick };
});
vi.mock("@/lib/igdb/search-cache", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/igdb/search-cache")>();
  return { ...actual, invalidateCacheByPrefix: mockInvalidateCacheByPrefix };
});
vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));
vi.mock("@/server/services/game-sync", () => ({
  checkCatalogueImportRateLimit: mockCheckCatalogueImportRateLimit,
  importGameByIgdbId: mockImportGameByIgdbId,
}));
vi.mock("@/lib/pinecone/sync", () => ({
  syncGameVector: mockSyncGameVector,
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import {
  toggleRecommendationFeedbackAction,
  recordRecommendationImpressionsAction,
  importRecommendedCatalogueGameAction,
} from "./recommendations";
import { initialActionState } from "@/lib/action-state";

const user = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockGetUser.mockResolvedValue({ data: { user } });
  mockGetClientIdentifier.mockResolvedValue("client-1");
  mockCheckCatalogueImportRateLimit.mockReturnValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});

describe("toggleRecommendationFeedbackAction", () => {
  it("rejects an invalid igdbId/eventType before any Supabase call", async () => {
    const result = await toggleRecommendationFeedbackAction(-1, "saved");
    expect(result.status).toBe("error");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an eventType outside the toggleable subset — a client can never claim a telemetry event", async () => {
    const result = await toggleRecommendationFeedbackAction(123, "shown");
    expect(result.status).toBe("error");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("never accepts a client-supplied gameId or userId — only igdbId/eventType reach the function signature at all", () => {
    // Structural proof, not a runtime assertion: the signature itself is
    // (igdbId: number, eventType: string) — TypeScript would fail to
    // compile any call site that tried to pass a third gameId/userId
    // argument, which is what makes this untestable-as-a-bypass rather
    // than merely undocumented.
    expect(toggleRecommendationFeedbackAction.length).toBe(2);
  });

  it("returns an error, not a redirect, for a signed-out caller", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await toggleRecommendationFeedbackAction(123, "saved");
    expect(result).toEqual({
      status: "error",
      active: false,
      message: "Sign in to leave feedback.",
    });
  });

  it("resolves game_id server-side from the validated igdbId when inserting — never from a client parameter", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing feedback row
      .mockResolvedValueOnce({ data: { id: "resolved-game-id" }, error: null }); // games lookup

    await toggleRecommendationFeedbackAction(123, "saved");

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        igdb_id: 123,
        game_id: "resolved-game-id",
        event_type: "saved",
      }),
    );
  });

  it("inserts with game_id null when no matching games row exists (catalogue-only)", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await toggleRecommendationFeedbackAction(456, "dismissed");

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ game_id: null, igdb_id: 456 }),
    );
  });

  it("deletes (toggles off) when an active row already exists, and invalidates the recommendations cache", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "row-1" },
      error: null,
    });

    const result = await toggleRecommendationFeedbackAction(123, "saved");

    expect(result).toEqual({ status: "success", active: false });
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInvalidateCacheByPrefix).toHaveBeenCalledWith(
      "recommendations:user-1:",
    );
  });

  it("treats a 23505 unique-violation on insert as success, matching review_likes'/follows' toggle-idempotency pattern", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mockInsert.mockResolvedValueOnce({ error: { code: "23505" } });

    const result = await toggleRecommendationFeedbackAction(123, "saved");

    expect(result).toEqual({ status: "success", active: true });
  });
});

describe("recordRecommendationImpressionsAction", () => {
  it("validates, dedupes, and caps the incoming array before ever querying", async () => {
    const tooMany = Array.from({ length: 41 }, (_, i) => i + 1);
    await recordRecommendationImpressionsAction(tooMany);
    // Rejected by the schema (max 40) — zod .safeParse fails, so nothing
    // is queried at all.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out caller", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await recordRecommendationImpressionsAction([1, 2, 3]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts only ids not already shown within the recent window — a partially-overlapping batch inserts just the new ones", async () => {
    // Simulate: igdb_id 2 already has a recent `shown` row; 1 and 3 don't.
    const inSelectResult = { data: [{ igdb_id: 2 }], error: null };
    const mockGte = vi.fn(() => Promise.resolve(inSelectResult));
    const mockInLocal = vi.fn(() => ({ gte: mockGte }));
    const mockEqEventType = vi.fn(() => ({ in: mockInLocal }));
    const mockEqUser = vi.fn(() => ({ eq: mockEqEventType }));
    const mockSelectLocal = vi.fn(() => ({ eq: mockEqUser }));
    const mockInsertLocal = vi.fn((_rows: { igdb_id: number }[]) =>
      Promise.resolve({ error: null }),
    );
    mockFrom.mockReturnValue({
      select: mockSelectLocal,
      insert: mockInsertLocal,
    } as never);

    await recordRecommendationImpressionsAction([1, 2, 3]);

    expect(mockInsertLocal).toHaveBeenCalledTimes(1);
    const insertedRows = mockInsertLocal.mock.calls[0]?.[0] as {
      igdb_id: number;
    }[];
    expect(insertedRows.map((r) => r.igdb_id).sort()).toEqual([1, 3]);
  });

  it("does not insert at all when the entire batch is already recently shown", async () => {
    const mockGte = vi.fn(() =>
      Promise.resolve({ data: [{ igdb_id: 1 }, { igdb_id: 2 }], error: null }),
    );
    const mockInLocal = vi.fn(() => ({ gte: mockGte }));
    const mockEqEventType = vi.fn(() => ({ in: mockInLocal }));
    const mockEqUser = vi.fn(() => ({ eq: mockEqEventType }));
    const mockSelectLocal = vi.fn(() => ({ eq: mockEqUser }));
    const mockInsertLocal = vi.fn((_rows: { igdb_id: number }[]) =>
      Promise.resolve({ error: null }),
    );
    mockFrom.mockReturnValue({
      select: mockSelectLocal,
      insert: mockInsertLocal,
    } as never);

    await recordRecommendationImpressionsAction([1, 2]);

    expect(mockInsertLocal).not.toHaveBeenCalled();
  });

  it("dedupes the incoming array before querying/inserting", async () => {
    const mockGte = vi.fn(() => Promise.resolve({ data: [], error: null }));
    const mockInLocal = vi.fn(() => ({ gte: mockGte }));
    const mockEqEventType = vi.fn(() => ({ in: mockInLocal }));
    const mockEqUser = vi.fn(() => ({ eq: mockEqEventType }));
    const mockSelectLocal = vi.fn(() => ({ eq: mockEqUser }));
    const mockInsertLocal = vi.fn((_rows: { igdb_id: number }[]) =>
      Promise.resolve({ error: null }),
    );
    mockFrom.mockReturnValue({
      select: mockSelectLocal,
      insert: mockInsertLocal,
    } as never);

    await recordRecommendationImpressionsAction([5, 5, 5]);

    const insertedRows = mockInsertLocal.mock.calls[0]?.[0] as {
      igdb_id: number;
    }[];
    expect(insertedRows).toHaveLength(1);
  });
});

describe("importRecommendedCatalogueGameAction", () => {
  function formWith(igdbId: string) {
    const data = new FormData();
    data.set("igdbId", igdbId);
    return data;
  }

  it("rejects an invalid igdbId before any rate-limit/import call", async () => {
    const result = await importRecommendedCatalogueGameAction(
      initialActionState,
      formWith("not-a-number"),
    );
    expect(result.status).toBe("error");
    expect(mockImportGameByIgdbId).not.toHaveBeenCalled();
  });

  it("respects the shared catalogue-import rate limit — same bucket as the generic import path, not a separate budget", async () => {
    mockCheckCatalogueImportRateLimit.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 5,
    });

    const result = await importRecommendedCatalogueGameAction(
      initialActionState,
      formWith("123"),
    );

    expect(result.status).toBe("error");
    expect(mockImportGameByIgdbId).not.toHaveBeenCalled();
  });

  it("records the click and then imports+redirects in the same request", async () => {
    mockImportGameByIgdbId.mockResolvedValue({
      id: "game-1",
      slug: "some-game",
    });

    await expect(
      importRecommendedCatalogueGameAction(initialActionState, formWith("123")),
    ).rejects.toThrow("REDIRECT:/games/some-game");

    expect(mockRecordClick).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      123,
    );
    expect(mockImportGameByIgdbId).toHaveBeenCalledWith(123);
  });

  it("a failed click-record never blocks the import", async () => {
    mockRecordClick.mockRejectedValue(new Error("telemetry down"));
    mockImportGameByIgdbId.mockResolvedValue({
      id: "game-1",
      slug: "some-game",
    });

    await expect(
      importRecommendedCatalogueGameAction(initialActionState, formWith("123")),
    ).rejects.toThrow("REDIRECT:/games/some-game");
  });

  it("returns a friendly error, doesn't crash, when the import itself fails", async () => {
    mockImportGameByIgdbId.mockRejectedValue(new Error("IGDB down"));

    const result = await importRecommendedCatalogueGameAction(
      initialActionState,
      formWith("123"),
    );

    expect(result.status).toBe("error");
  });
});
