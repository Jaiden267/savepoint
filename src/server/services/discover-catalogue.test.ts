import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";
import { _resetIgdbSearchCacheForTests } from "@/lib/igdb/search-cache";

const {
  mockAdminFrom,
  mockPineconeFetch,
  mockEnsureConfiguredIndex,
  mockPickKeysetThresholds,
  mockSeededShuffle,
} = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockPineconeFetch: vi.fn(),
  mockEnsureConfiguredIndex: vi.fn(),
  mockPickKeysetThresholds: vi.fn(),
  mockSeededShuffle: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/pinecone/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pinecone/client")>();
  return {
    ...actual,
    ensureConfiguredIndex: mockEnsureConfiguredIndex,
  };
});

vi.mock("@/lib/random/seeded-random", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/random/seeded-random")>();
  // Wire the hoisted mock references themselves into the module exports
  // (not fresh, disconnected vi.fn() wrappers) so a test's
  // mockPickKeysetThresholds.mockReturnValueOnce(...) actually affects
  // what discover-catalogue.ts calls. Real implementation is the default
  // behavior, restored in beforeEach after vi.clearAllMocks() strips it.
  mockPickKeysetThresholds.mockImplementation(actual.pickKeysetThresholds);
  mockSeededShuffle.mockImplementation(actual.seededShuffle);
  return {
    ...actual,
    pickKeysetThresholds: mockPickKeysetThresholds,
    seededShuffle: mockSeededShuffle,
  };
});

// A faithful, real-shape reimplementation of toSearchResult (matching
// game-catalogue.ts exactly) plus a controllable checkDiscoverRateLimit —
// same manual-mock pattern semantic-search.test.ts already uses for this
// module.
vi.mock("@/server/services/game-catalogue", () => ({
  toSearchResult: (row: {
    igdb_id: number;
    slug: string;
    name: string;
    cover_image_id: string | null;
    release_date: string | null;
    igdb_game_type: string | null;
    version_parent_igdb_id: number | null;
  }) => ({
    source: "local",
    igdbId: row.igdb_id,
    slug: row.slug,
    name: row.name,
    coverImageId: row.cover_image_id,
    releaseYear: row.release_date
      ? new Date(row.release_date).getUTCFullYear()
      : null,
    gameType: row.igdb_game_type,
    versionParentIgdbId: row.version_parent_igdb_id,
  }),
  checkDiscoverRateLimit: (clientId: string) =>
    mockCheckDiscoverRateLimit(clientId),
}));

const mockCheckDiscoverRateLimit = vi.fn((_clientId: string) => ({
  allowed: true,
  retryAfterSeconds: 0,
}));

import {
  listDiscoverCatalogue,
  DiscoverCatalogueUnavailableError,
  DiscoverRateLimitedError,
} from "./discover-catalogue";
import { PineconeIndexUnavailableError } from "@/lib/pinecone/client";
import { buildCatalogueRecordId } from "@/lib/pinecone/constants";
import { PINECONE_SCHEMA_VERSION } from "@/lib/pinecone/constants";
import type { Rng } from "@/lib/random/seeded-random";

// ---- Fake ledger (igdb_catalogue_sync) admin-client query engine ----
//
// Bounds queries (.order().limit(1), no gte/lt) resolve from `bounds`.
// Window queries (.gte()/optionally .lt().order().limit(n)) resolve from
// `windows`, keyed by the exact filter shape — since pickKeysetThresholds
// is spied (real by default, overridable per test), tests that need
// precise control over which threshold gets queried use
// mockPickKeysetThresholds.mockReturnValueOnce(...) first.

interface LedgerFixture {
  bounds: { min: number; max: number } | null;
  windows: Map<string, number[]>; // key: `gte:${v}` or `gte:${v}|lt:${v2}`
}

function windowKey(gte: number, lt?: number): string {
  return lt === undefined ? `gte:${gte}` : `gte:${gte}|lt:${lt}`;
}

function setupLedgerMock(fixture: LedgerFixture) {
  const calls: { gte?: number; lt?: number; limit: number }[] = [];

  mockAdminFrom.mockImplementation((table: string) => {
    if (table !== "igdb_catalogue_sync") {
      throw new Error(`unexpected admin table: ${table}`);
    }
    let gteVal: number | undefined;
    let ltVal: number | undefined;
    let ascending = true;

    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn((_col: string, v: number) => {
        gteVal = v;
        return chain;
      }),
      lt: vi.fn((_col: string, v: number) => {
        ltVal = v;
        return chain;
      }),
      order: vi.fn((_col: string, opts: { ascending: boolean }) => {
        ascending = opts.ascending;
        return chain;
      }),
      limit: vi.fn((n: number) => {
        calls.push({ gte: gteVal, lt: ltVal, limit: n });
        if (gteVal === undefined && ltVal === undefined) {
          // Bounds query.
          if (!fixture.bounds) {
            return Promise.resolve({ data: [], error: null });
          }
          const id = ascending ? fixture.bounds.min : fixture.bounds.max;
          return Promise.resolve({ data: [{ igdb_id: id }], error: null });
        }
        const ids = fixture.windows.get(windowKey(gteVal!, ltVal)) ?? [];
        const sorted = ascending
          ? [...ids].sort((a, b) => a - b)
          : [...ids].sort((a, b) => b - a);
        return Promise.resolve({
          data: sorted.slice(0, n).map((id) => ({ igdb_id: id })),
          error: null,
        });
      }),
    };
    return chain;
  });

  return calls;
}

function setupErroringLedgerMock(message: string) {
  mockAdminFrom.mockImplementation(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve({ data: null, error: { message } })),
    };
    return chain;
  });
}

// ---- Fake Pinecone namespace + games table ----

function catalogueMetadata(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: PINECONE_SCHEMA_VERSION,
    igdb_id: 1,
    slug: "game-1",
    name: "Game One",
    cover_image_id: "cover-1",
    release_year: 2020,
    ...overrides,
  };
}

function setupPineconeMock(
  recordsByIgdbId: Map<number, Record<string, unknown> | undefined>,
) {
  mockPineconeFetch.mockImplementation(({ ids }: { ids: string[] }) => {
    const records: Record<string, { metadata: unknown }> = {};
    for (const id of ids) {
      const igdbId = Number(id.replace("igdb-", ""));
      const metadata = recordsByIgdbId.get(igdbId);
      if (metadata) records[id] = { metadata };
    }
    return Promise.resolve({ records });
  });
  mockEnsureConfiguredIndex.mockResolvedValue({ fetch: mockPineconeFetch });
}

function gameRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    igdb_id: 1,
    slug: "cached-game-1",
    name: "Cached Game One",
    cover_image_id: "cover-cached",
    release_date: "2019-01-01",
    igdb_game_type: "Main Game",
    version_parent_igdb_id: null,
    ...overrides,
  };
}

function setupGamesSupabase(rows: Record<string, unknown>[]) {
  const inCalls: unknown[][] = [];
  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn((_col: string, values: unknown[]) => {
      inCalls.push(values);
      return Promise.resolve({ data: rows, error: null });
    }),
  };
  const supabase = { from: vi.fn(() => chain) } as unknown as Parameters<
    typeof listDiscoverCatalogue
  >[0];
  return { supabase, inCalls, chain };
}

const CLIENT_ID = "test-client";

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  _resetIgdbSearchCacheForTests();
  mockCheckDiscoverRateLimit.mockReturnValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mockPickKeysetThresholds.mockImplementation(
    (rng: Rng, min: number, max: number, count: number) => {
      // Default real behavior restored per test via importOriginal spy;
      // vi.clearAllMocks() strips the implementation, so re-wire it here.
      const span = max - min + 1;
      const out: number[] = [];
      for (let i = 0; i < count; i++) out.push(min + Math.floor(rng() * span));
      return out;
    },
  );
  mockSeededShuffle.mockImplementation(<T>(_rng: Rng, items: readonly T[]) =>
    items.slice(),
  );
});

describe("listDiscoverCatalogue — sampling correctness", () => {
  it("is not limited to the games cache — includes a catalogue-only (igdb-source) record", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 1000 },
      windows: new Map([[windowKey(1), [1, 2]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(
      new Map([[2, catalogueMetadata({ igdb_id: 2, slug: "uncached-game" })]]),
    );
    const { supabase } = setupGamesSupabase([]); // nothing cached

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 1,
      clientId: CLIENT_ID,
    });

    const uncached = outcome.results.find((r) => r.igdbId === 2);
    expect(uncached).toMatchObject({ source: "igdb", slug: "uncached-game" });
  });

  it("returns unique igdb_ids — no duplicates even when windows overlap", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 1000 },
      windows: new Map([
        [windowKey(1), [1, 2, 3]],
        [windowKey(2), [2, 3, 4]], // overlaps with the first window
      ]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 2, 1, 2]);
    setupPineconeMock(
      new Map([
        [1, catalogueMetadata({ igdb_id: 1, slug: "g1" })],
        [2, catalogueMetadata({ igdb_id: 2, slug: "g2" })],
        [3, catalogueMetadata({ igdb_id: 3, slug: "g3" })],
        [4, catalogueMetadata({ igdb_id: 4, slug: "g4" })],
      ]),
    );
    const { supabase } = setupGamesSupabase([]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 2,
      clientId: CLIENT_ID,
    });

    const ids = outcome.results.map((r) => r.igdbId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps distinct games sharing the same title as separate results, identified by igdb_id — never deduped by title", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 1000 },
      windows: new Map([[windowKey(1), [10, 20]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(
      new Map([
        [
          10,
          catalogueMetadata({
            igdb_id: 10,
            slug: "thor-god-of-thunder",
            name: "Thor: God of Thunder",
          }),
        ],
        [
          20,
          catalogueMetadata({
            igdb_id: 20,
            slug: "thor-god-of-thunder--1",
            name: "Thor: God of Thunder",
          }),
        ],
      ]),
    );
    const { supabase } = setupGamesSupabase([]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 3,
      clientId: CLIENT_ID,
    });

    expect(outcome.results.map((r) => r.igdbId).sort()).toEqual([10, 20]);
    expect(
      outcome.results.every((r) => r.name === "Thor: God of Thunder"),
    ).toBe(true);
  });

  it("uses the canonical buildCatalogueRecordId shape when fetching from Pinecone, never a raw numeric id", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 1000 },
      windows: new Map([[windowKey(1), [42]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(new Map([[42, catalogueMetadata({ igdb_id: 42 })]]));
    const { supabase } = setupGamesSupabase([]);

    await listDiscoverCatalogue(supabase, { seed: 4, clientId: CLIENT_ID });

    expect(mockPineconeFetch).toHaveBeenCalledWith({
      ids: [buildCatalogueRecordId(42)],
    });
  });
});

describe("listDiscoverCatalogue — deterministic wrap-around near the max id", () => {
  it("issues exactly one deterministic supplemental query wrapping to the global min when a threshold under-delivers", async () => {
    // Only 3 rows total exist above threshold 990 (max is 1000), well
    // under WINDOW_LIMIT (8) — forces a wrap-around to min=1.
    const calls = setupLedgerMock({
      bounds: { min: 1, max: 1000 },
      windows: new Map([
        [windowKey(990), [995, 998, 1000]],
        [windowKey(1, 990), [1, 2, 3, 4, 5]],
      ]),
    });
    mockPickKeysetThresholds.mockReturnValue([990, 990, 990, 990]);
    setupPineconeMock(
      new Map(
        [995, 998, 1000, 1, 2, 3, 4, 5].map((id) => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ),
    );
    const { supabase } = setupGamesSupabase([]);

    await listDiscoverCatalogue(supabase, { seed: 5, clientId: CLIENT_ID });

    const wrapCalls = calls.filter((c) => c.gte === 1 && c.lt === 990);
    expect(wrapCalls.length).toBeGreaterThan(0);
  });

  it("same seed produces the same wrap-around decision twice (deterministic, not extra randomness)", async () => {
    const fixture = (): LedgerFixture => ({
      bounds: { min: 1, max: 1000 },
      windows: new Map([
        [windowKey(990), [995]],
        [windowKey(1, 990), [1, 2, 3]],
      ]),
    });
    setupLedgerMock(fixture());
    mockPickKeysetThresholds.mockReturnValue([990, 990, 990, 990]);
    setupPineconeMock(
      new Map(
        [995, 1, 2, 3].map((id) => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ),
    );
    const { supabase: supabaseA } = setupGamesSupabase([]);
    const outcomeA = await listDiscoverCatalogue(supabaseA, {
      seed: 6,
      clientId: "client-a",
    });

    setupLedgerMock(fixture());
    setupPineconeMock(
      new Map(
        [995, 1, 2, 3].map((id) => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ),
    );
    const { supabase: supabaseB } = setupGamesSupabase([]);
    const outcomeB = await listDiscoverCatalogue(supabaseB, {
      seed: 6,
      clientId: "client-b",
    });

    expect(outcomeA.results.map((r) => r.igdbId).sort()).toEqual(
      outcomeB.results.map((r) => r.igdbId).sort(),
    );
  });
});

describe("listDiscoverCatalogue — post-hydration refill, keyed off valid count", () => {
  it("triggers exactly one supplemental round when a raw pool of 32 hydrates to fewer than FULL_RESULT_FLOOR valid results, excluding ids already attempted", async () => {
    // Round 1: 4 windows of 8 raw ids each = 32 raw ids (1..32), but only
    // 15 of them have valid Pinecone metadata — hydrated count (15) is
    // below FULL_RESULT_FLOOR (20), so a refill round must fire.
    const round1Ids = Array.from({ length: 32 }, (_, i) => i + 1);
    mockPickKeysetThresholds
      .mockReturnValueOnce([1, 1, 1, 1]) // round 1 draws all from one window key for simplicity
      .mockReturnValueOnce([2000, 2000]); // refill round, disjoint range
    setupLedgerMock({
      bounds: { min: 1, max: 5000 },
      windows: new Map([
        [windowKey(1), round1Ids.slice(0, 8)],
        // four identical-key calls aren't realistic with real thresholds,
        // so instead drive round 1 via 4 distinct window keys:
      ]),
    });
    // Re-setup with 4 distinct thresholds representing round 1's 4 windows.
    mockPickKeysetThresholds
      .mockReset()
      .mockReturnValueOnce([1, 100, 200, 300])
      .mockReturnValueOnce([2000, 2100]);
    const calls = setupLedgerMock({
      bounds: { min: 1, max: 5000 },
      windows: new Map([
        [windowKey(1), [1, 2, 3, 4, 5, 6, 7, 8]],
        [windowKey(100), [101, 102, 103, 104, 105, 106, 107, 108]],
        [windowKey(200), [201, 202, 203, 204, 205, 206, 207, 208]],
        [windowKey(300), [301, 302, 303, 304, 305, 306, 307, 308]],
        [windowKey(2000), [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008]],
        [windowKey(2100), [2101, 2102, 2103, 2104, 2105, 2106, 2107, 2108]],
      ]),
    });
    const round1Full = [
      1, 2, 3, 4, 5, 6, 7, 8, 101, 102, 103, 104, 105, 106, 107, 108, 201, 202,
      203, 204, 205, 206, 207, 208, 301, 302, 303, 304, 305, 306, 307, 308,
    ];
    // Only the first 15 of round 1's ids have valid Pinecone metadata; the
    // rest are missing (simulating validation/missing-record drops).
    const validRound1 = round1Full.slice(0, 15);
    const refillIds = [
      2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2101, 2102, 2103, 2104,
      2105, 2106, 2107, 2108,
    ];
    setupPineconeMock(
      new Map([
        ...validRound1.map((id): [number, Record<string, unknown>] => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
        ...refillIds.map((id): [number, Record<string, unknown>] => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ]),
    );
    const { supabase } = setupGamesSupabase([]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 7,
      clientId: CLIENT_ID,
    });

    // Refill queries (gte 2000/2100) were issued.
    expect(calls.some((c) => c.gte === 2000)).toBe(true);
    expect(calls.some((c) => c.gte === 2100)).toBe(true);
    // Refill ids never overlap with round 1's attempted ids (disjoint
    // ranges by construction — the exclusion check is that no id from
    // round1Full appears in the refill query keys, which it structurally
    // can't here since the ranges don't intersect; the meaningful
    // assertion is that valid results include ids from BOTH rounds).
    const resultIds = new Set(outcome.results.map((r) => r.igdbId));
    expect(validRound1.some((id) => resultIds.has(id))).toBe(true);
    expect(refillIds.some((id) => resultIds.has(id))).toBe(true);
  });

  it("never triggers a refill when the first round already hydrates to FULL_RESULT_FLOOR or more valid results", async () => {
    const ids = Array.from({ length: 24 }, (_, i) => i + 1);
    mockPickKeysetThresholds.mockReturnValue([1, 100, 200, 300]);
    setupLedgerMock({
      bounds: { min: 1, max: 5000 },
      windows: new Map([
        [windowKey(1), ids.slice(0, 6)],
        [windowKey(100), ids.slice(6, 12)],
        [windowKey(200), ids.slice(12, 18)],
        [windowKey(300), ids.slice(18, 24)],
      ]),
    });
    setupPineconeMock(
      new Map(
        ids.map((id) => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ),
    );
    const { supabase } = setupGamesSupabase([]);

    await listDiscoverCatalogue(supabase, { seed: 8, clientId: CLIENT_ID });

    // Exactly one Pinecone fetch call — no supplemental hydration round.
    expect(mockPineconeFetch).toHaveBeenCalledTimes(1);
  });
});

describe("listDiscoverCatalogue — no incorrect cached-only fallback", () => {
  it("returns a reduced (non-fallback) selection when a post-refill valid count is between 1 and FULL_RESULT_FLOOR-1", async () => {
    mockPickKeysetThresholds
      .mockReturnValueOnce([1, 100, 200, 300])
      .mockReturnValueOnce([2000, 2100]);
    setupLedgerMock({
      bounds: { min: 1, max: 5000 },
      windows: new Map([
        [windowKey(1), [1, 2]],
        [windowKey(100), [101, 102]],
        [windowKey(200), [201, 202]],
        [windowKey(300), [301, 302]],
        [windowKey(2000), [2001]],
        [windowKey(2100), [2101]],
      ]),
    });
    const validIds = [1, 101, 201, 301, 2001]; // 5 valid — reduced, not zero
    setupPineconeMock(
      new Map(
        validIds.map((id) => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ),
    );
    const { supabase } = setupGamesSupabase([]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 9,
      clientId: CLIENT_ID,
    });

    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.length).toBeLessThan(20);
    expect(outcome.reduced).toBe(true);
  });

  it("throws DiscoverCatalogueUnavailableError only when zero valid results remain after the bounded refill", async () => {
    mockPickKeysetThresholds
      .mockReturnValueOnce([1, 100, 200, 300])
      .mockReturnValueOnce([2000, 2100]);
    setupLedgerMock({
      bounds: { min: 1, max: 5000 },
      windows: new Map([
        [windowKey(1), [1]],
        [windowKey(100), [101]],
        [windowKey(200), [201]],
        [windowKey(300), [301]],
        [windowKey(2000), [2001]],
        [windowKey(2100), [2101]],
      ]),
    });
    setupPineconeMock(new Map()); // nothing hydrates
    const { supabase } = setupGamesSupabase([]);

    await expect(
      listDiscoverCatalogue(supabase, { seed: 10, clientId: CLIENT_ID }),
    ).rejects.toThrow(DiscoverCatalogueUnavailableError);
  });
});

describe("listDiscoverCatalogue — diversity pass", () => {
  it("never drops a valid candidate or falls short of the target purely to enforce diversity caps", async () => {
    // 24 candidates, all the SAME franchise key (would blow every cap),
    // all with valid metadata. The diversity pass must still return all
    // 24 — caps are a preference, never an exclusion.
    const ids = Array.from({ length: 24 }, (_, i) => i + 1);
    mockPickKeysetThresholds.mockReturnValue([1, 100, 200, 300]);
    setupLedgerMock({
      bounds: { min: 1, max: 5000 },
      windows: new Map([
        [windowKey(1), ids.slice(0, 6)],
        [windowKey(100), ids.slice(6, 12)],
        [windowKey(200), ids.slice(12, 18)],
        [windowKey(300), ids.slice(18, 24)],
      ]),
    });
    setupPineconeMock(
      new Map(
        ids.map((id) => [
          id,
          catalogueMetadata({
            igdb_id: id,
            slug: `same-franchise-${id}`,
            name: "Same Franchise Title",
          }),
        ]),
      ),
    );
    const { supabase } = setupGamesSupabase([]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 11,
      clientId: CLIENT_ID,
    });

    expect(outcome.results).toHaveLength(24);
    expect(new Set(outcome.results.map((r) => r.igdbId)).size).toBe(24);
  });

  it("keeps distinct igdb_ids that share a title even under the franchise-key cap — never excluded by the diversity pass", async () => {
    const ids = [1, 2, 3, 4, 5];
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), ids]]),
    });
    setupPineconeMock(
      new Map(
        ids.map((id) => [
          id,
          catalogueMetadata({
            igdb_id: id,
            slug: `dup-${id}`,
            name: "Duplicate Title",
          }),
        ]),
      ),
    );
    const { supabase } = setupGamesSupabase([]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 12,
      clientId: CLIENT_ID,
    });

    expect(outcome.results.map((r) => r.igdbId).sort()).toEqual(ids);
  });
});

describe("listDiscoverCatalogue — server-only / read-only", () => {
  it("never calls a write method on the ledger admin client, Pinecone namespace, or games client, across the success path", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1, 2]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(
      new Map([
        [1, catalogueMetadata({ igdb_id: 1 })],
        [2, catalogueMetadata({ igdb_id: 2 })],
      ]),
    );
    const { supabase, chain: gamesChain } = setupGamesSupabase([]);
    const namespaceMock = { fetch: mockPineconeFetch } as Record<
      string,
      unknown
    >;
    mockEnsureConfiguredIndex.mockResolvedValue(namespaceMock);

    await listDiscoverCatalogue(supabase, { seed: 13, clientId: CLIENT_ID });

    for (const method of ["insert", "update", "delete", "upsert"]) {
      expect(namespaceMock[method]).toBeUndefined();
      expect(
        (gamesChain as unknown as Record<string, unknown>)[method],
      ).toBeUndefined();
    }
  });

  it("never returns a client reference — only plain data", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(new Map([[1, catalogueMetadata({ igdb_id: 1 })]]));
    const { supabase } = setupGamesSupabase([]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 14,
      clientId: CLIENT_ID,
    });

    expect(outcome).not.toHaveProperty("from");
    expect(outcome).not.toHaveProperty("client");
    expect(typeof outcome.results).toBe("object");
    expect(typeof outcome.reduced).toBe("boolean");
  });
});

describe("listDiscoverCatalogue — rate limiting", () => {
  it("throws DiscoverRateLimitedError before any ledger/Pinecone call when checkDiscoverRateLimit disallows an uncached seed", async () => {
    mockCheckDiscoverRateLimit.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 30,
    });
    setupLedgerMock({ bounds: { min: 1, max: 100 }, windows: new Map() });
    const { supabase } = setupGamesSupabase([]);

    await expect(
      listDiscoverCatalogue(supabase, { seed: 15, clientId: CLIENT_ID }),
    ).rejects.toThrow(DiscoverRateLimitedError);
    expect(mockAdminFrom).not.toHaveBeenCalled();
    expect(mockPineconeFetch).not.toHaveBeenCalled();
  });

  it("still independently rate-limits a different, uncached seed for the same client", async () => {
    mockCheckDiscoverRateLimit
      .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockReturnValueOnce({ allowed: false, retryAfterSeconds: 10 });
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(new Map([[1, catalogueMetadata({ igdb_id: 1 })]]));
    const { supabase } = setupGamesSupabase([]);

    await listDiscoverCatalogue(supabase, { seed: 16, clientId: CLIENT_ID });
    await expect(
      listDiscoverCatalogue(supabase, { seed: 17, clientId: CLIENT_ID }),
    ).rejects.toThrow(DiscoverRateLimitedError);
  });
});

describe("listDiscoverCatalogue — seed-result cache, checked before the rate limit", () => {
  it("a cache hit returns immediately with zero ledger/Pinecone/games calls and never consults the rate limiter", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(new Map([[1, catalogueMetadata({ igdb_id: 1 })]]));
    const { supabase } = setupGamesSupabase([]);

    // First call populates the cache for seed=18.
    await listDiscoverCatalogue(supabase, { seed: 18, clientId: CLIENT_ID });

    vi.clearAllMocks();
    mockCheckDiscoverRateLimit.mockReturnValue({
      allowed: true,
      retryAfterSeconds: 0,
    });

    const second = await listDiscoverCatalogue(supabase, {
      seed: 18,
      clientId: CLIENT_ID,
    });

    expect(second.results.length).toBeGreaterThan(0);
    expect(mockAdminFrom).not.toHaveBeenCalled();
    expect(mockPineconeFetch).not.toHaveBeenCalled();
    expect(mockCheckDiscoverRateLimit).not.toHaveBeenCalled();
  });

  it("a different, not-yet-cached seed is still correctly subject to the rate limit even right after a cache hit", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(new Map([[1, catalogueMetadata({ igdb_id: 1 })]]));
    const { supabase } = setupGamesSupabase([]);
    await listDiscoverCatalogue(supabase, { seed: 19, clientId: CLIENT_ID });

    mockCheckDiscoverRateLimit.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 5,
    });

    await expect(
      listDiscoverCatalogue(supabase, { seed: 20, clientId: CLIENT_ID }),
    ).rejects.toThrow(DiscoverRateLimitedError);
  });

  it("only a genuine successful selection is cached — a fallback/error outcome is never pinned under the seed key", async () => {
    setupErroringLedgerMock("simulated ledger failure");
    const { supabase } = setupGamesSupabase([]);

    await expect(
      listDiscoverCatalogue(supabase, { seed: 21, clientId: CLIENT_ID }),
    ).rejects.toThrow(DiscoverCatalogueUnavailableError);

    // Retrying the identical seed after fixing the ledger must not be
    // short-circuited by a stale cached error — it should attempt real
    // work again.
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(new Map([[1, catalogueMetadata({ igdb_id: 1 })]]));

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 21,
      clientId: CLIENT_ID,
    });
    expect(outcome.results.length).toBeGreaterThan(0);
  });
});

describe("listDiscoverCatalogue — genuine unavailability", () => {
  it("throws DiscoverCatalogueUnavailableError when the ledger has no synced rows at all", async () => {
    setupLedgerMock({ bounds: null, windows: new Map() });
    const { supabase } = setupGamesSupabase([]);

    await expect(
      listDiscoverCatalogue(supabase, { seed: 22, clientId: CLIENT_ID }),
    ).rejects.toThrow(DiscoverCatalogueUnavailableError);
  });

  it("throws DiscoverCatalogueUnavailableError when a ledger query returns a real error", async () => {
    setupErroringLedgerMock("connection reset");
    const { supabase } = setupGamesSupabase([]);

    await expect(
      listDiscoverCatalogue(supabase, { seed: 23, clientId: CLIENT_ID }),
    ).rejects.toThrow(DiscoverCatalogueUnavailableError);
  });

  it("propagates PineconeIndexUnavailableError as-is rather than swallowing it — the caller decides fallback behavior", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    mockEnsureConfiguredIndex.mockRejectedValue(
      new PineconeIndexUnavailableError("index missing"),
    );
    const { supabase } = setupGamesSupabase([]);

    await expect(
      listDiscoverCatalogue(supabase, { seed: 24, clientId: CLIENT_ID }),
    ).rejects.toThrow(PineconeIndexUnavailableError);
  });
});

describe("listDiscoverCatalogue — cached vs. catalogue-only card identity", () => {
  it("a candidate present in the games table renders as source: local with its real stored slug", async () => {
    setupLedgerMock({
      bounds: { min: 1, max: 100 },
      windows: new Map([[windowKey(1), [1]]]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 1, 1, 1]);
    setupPineconeMock(new Map([[1, catalogueMetadata({ igdb_id: 1 })]]));
    const { supabase } = setupGamesSupabase([
      gameRow({ igdb_id: 1, slug: "the-real-stored-slug" }),
    ]);

    const outcome = await listDiscoverCatalogue(supabase, {
      seed: 25,
      clientId: CLIENT_ID,
    });

    expect(outcome.results[0]).toMatchObject({
      source: "local",
      slug: "the-real-stored-slug",
      igdbId: 1,
    });
  });
});

describe("listDiscoverCatalogue — determinism across rerenders/requests", () => {
  it("the same seed produces an identical result order twice (stable across rerenders)", async () => {
    const ids = Array.from({ length: 24 }, (_, i) => i + 1);
    const fixture = (): LedgerFixture => ({
      bounds: { min: 1, max: 5000 },
      windows: new Map([
        [windowKey(1), ids.slice(0, 6)],
        [windowKey(100), ids.slice(6, 12)],
        [windowKey(200), ids.slice(12, 18)],
        [windowKey(300), ids.slice(18, 24)],
      ]),
    });
    mockPickKeysetThresholds.mockReturnValue([1, 100, 200, 300]);

    setupLedgerMock(fixture());
    setupPineconeMock(
      new Map(
        ids.map((id) => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ),
    );
    const { supabase: supabaseA } = setupGamesSupabase([]);
    const a = await listDiscoverCatalogue(supabaseA, {
      seed: 999,
      clientId: "client-x",
    });

    _resetIgdbSearchCacheForTests();
    setupLedgerMock(fixture());
    setupPineconeMock(
      new Map(
        ids.map((id) => [
          id,
          catalogueMetadata({ igdb_id: id, slug: `g${id}` }),
        ]),
      ),
    );
    const { supabase: supabaseB } = setupGamesSupabase([]);
    const b = await listDiscoverCatalogue(supabaseB, {
      seed: 999,
      clientId: "client-y",
    });

    expect(a.results.map((r) => r.igdbId)).toEqual(
      b.results.map((r) => r.igdbId),
    );
  });
});
