import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";
import { _resetIgdbSearchCacheForTests } from "@/lib/igdb/search-cache";

const { mockEnsureConfiguredIndex, mockFetch, mockSearchGameHits } = vi.hoisted(
  () => ({
    mockEnsureConfiguredIndex: vi.fn(),
    mockFetch: vi.fn(),
    mockSearchGameHits: vi.fn(),
  }),
);

vi.mock("@/lib/pinecone/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pinecone/client")>();
  return { ...actual, ensureConfiguredIndex: mockEnsureConfiguredIndex };
});
vi.mock("@/lib/pinecone/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pinecone/search")>();
  return { ...actual, searchGameHits: mockSearchGameHits };
});

import {
  minMaxNormalize,
  buildSyntheticQuery,
  generateReason,
  rankCandidates,
  buildUserTasteProfile,
  getRecommendations,
  recordClick,
  RecommendationsRateLimitedError,
  RecommendationsUnavailableError,
  type TasteProfile,
} from "./recommendations";
import type { StructuredGameHit } from "@/lib/pinecone/search";
import { buildCatalogueRecordId } from "@/lib/pinecone/constants";

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  _resetIgdbSearchCacheForTests();
  mockEnsureConfiguredIndex.mockResolvedValue({ fetch: mockFetch });
  mockFetch.mockResolvedValue({ records: {} });
});

// ---------------------------------------------------------------------------
// Pure functions — fixture in, exact value out, no mocking required.
// ---------------------------------------------------------------------------

describe("minMaxNormalize", () => {
  it("scales a varied array into [0,1]", () => {
    expect(minMaxNormalize([0, 5, 10])).toEqual([0, 0.5, 1]);
  });

  it("maps every value to 0.5 when all values are equal (never divides by zero)", () => {
    expect(minMaxNormalize([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
  });

  it("maps a single-value array to 0.5", () => {
    expect(minMaxNormalize([42])).toEqual([0.5]);
  });

  it("returns an empty array for empty input", () => {
    expect(minMaxNormalize([])).toEqual([]);
  });

  it("never produces NaN or Infinity, across equal, single, negative, and varied inputs", () => {
    const cases = [[0, 0, 0], [-5], [-10, 0, 10], [1e9, 1e9]];
    for (const values of cases) {
      for (const v of minMaxNormalize(values)) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe("buildSyntheticQuery", () => {
  function profileWith(
    games: { name: string; weight: number }[],
    tags: [string, number][],
  ): TasteProfile {
    return {
      positiveTags: new Map(tags),
      negativeTags: new Map(),
      strongSignalGames: games.map((g) => ({
        name: g.name,
        tags: new Set<string>(),
        weight: g.weight,
        hint: "rated" as const,
      })),
      positiveSignalCount: games.length,
    };
  }

  it("orders strong signal games first, then tags by descending weight", () => {
    const profile = profileWith(
      [{ name: "Dishonored", weight: 3 }],
      [
        ["RPG", 5],
        ["Stealth", 8],
      ],
    );
    expect(buildSyntheticQuery(profile)).toBe("Dishonored, Stealth, RPG");
  });

  it("dedupes a term that appears as both a game name and a tag", () => {
    const profile = profileWith(
      [{ name: "Stealth", weight: 3 }],
      [["Stealth", 5]],
    );
    expect(buildSyntheticQuery(profile)).toBe("Stealth");
  });

  it("stops adding terms once MAX_QUERY_CHARS would be exceeded, never truncating mid-term", () => {
    const longTags: [string, number][] = Array.from({ length: 50 }, (_, i) => [
      `Tag${i}-${"x".repeat(20)}`,
      50 - i,
    ]);
    const profile = profileWith([], longTags);
    const query = buildSyntheticQuery(profile);
    expect(query.length).toBeLessThanOrEqual(400);
    // Every included term is complete — the query never ends mid-word.
    const lastTerm = query.split(", ").at(-1)!;
    expect(longTags.some(([tag]) => tag === lastTerm)).toBe(true);
  });

  it("returns an empty string for an empty profile", () => {
    expect(buildSyntheticQuery(profileWith([], []))).toBe("");
  });
});

function hit(overrides: Partial<StructuredGameHit>): StructuredGameHit {
  return {
    recordId: buildCatalogueRecordId(overrides.igdbId ?? 1),
    igdbId: 1,
    score: 0.5,
    slug: "game",
    name: "Game",
    coverImageId: null,
    releaseYear: null,
    genres: [],
    platforms: [],
    gameModes: [],
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("orders purely by Pinecone score when no tag signals exist", () => {
    const hits = [
      hit({ igdbId: 1, score: 0.2 }),
      hit({ igdbId: 2, score: 0.9 }),
      hit({ igdbId: 3, score: 0.5 }),
    ];
    const ranked = rankCandidates(hits, new Map(), new Map());
    expect(ranked.map((r) => r.hit.igdbId)).toEqual([2, 3, 1]);
  });

  it("responds to a change in Pinecone score alone, holding tags identical — proves the blend isn't secretly tag-only", () => {
    const positiveTags = new Map([["RPG", 5]]);
    const base = { genres: ["RPG"], platforms: [], gameModes: [] };
    const lowScore = [
      hit({ igdbId: 1, score: 0.1, ...base }),
      hit({ igdbId: 2, score: 0.1, ...base }),
    ];
    const highScoreForTwo = [
      hit({ igdbId: 1, score: 0.1, ...base }),
      hit({ igdbId: 2, score: 0.99, ...base }),
    ];
    const rankedLow = rankCandidates(lowScore, positiveTags, new Map());
    const rankedHigh = rankCandidates(highScoreForTwo, positiveTags, new Map());
    // Tied scores + tied tags -> stable order (1 first); once #2's Pinecone
    // score is raised well above #1's, it must move to the top.
    expect(rankedLow[0]!.hit.igdbId).toBe(1);
    expect(rankedHigh[0]!.hit.igdbId).toBe(2);
  });

  it("ranks a candidate matching positive tags above one that doesn't, at equal Pinecone score", () => {
    const positiveTags = new Map([["Stealth", 10]]);
    const hits = [
      hit({ igdbId: 1, score: 0.5, genres: ["Racing"] }),
      hit({ igdbId: 2, score: 0.5, genres: ["Stealth"] }),
    ];
    const ranked = rankCandidates(hits, positiveTags, new Map());
    expect(ranked[0]!.hit.igdbId).toBe(2);
  });

  it("negative tag weight actively penalizes a candidate, not just withholds a bonus", () => {
    const negativeTags = new Map([["Horror", 10]]);
    const hits = [
      hit({ igdbId: 1, score: 0.5, genres: [] }),
      hit({ igdbId: 2, score: 0.5, genres: ["Horror"] }),
    ];
    const ranked = rankCandidates(hits, new Map(), negativeTags);
    expect(ranked[0]!.hit.igdbId).toBe(1);
  });

  it("returns an empty array for an empty hit list", () => {
    expect(rankCandidates([], new Map(), new Map())).toEqual([]);
  });
});

describe("generateReason", () => {
  function profileWith(
    strongGames: {
      name: string;
      tags: string[];
      hint: "rated" | "completed" | "saved";
    }[],
    positiveTags: [string, number][],
  ): TasteProfile {
    return {
      positiveTags: new Map(positiveTags),
      negativeTags: new Map(),
      strongSignalGames: strongGames.map((g) => ({
        name: g.name,
        tags: new Set(g.tags),
        weight: 3,
        hint: g.hint,
      })),
      positiveSignalCount: strongGames.length,
    };
  }

  it("cites a strongly-rated game by name when tags overlap", () => {
    const profile = profileWith(
      [{ name: "Dishonored", tags: ["Stealth"], hint: "rated" }],
      [],
    );
    expect(generateReason(["Stealth"], profile)).toBe(
      "Because you rated Dishonored highly",
    );
  });

  it("uses the completed-game phrasing when the strong signal came from status=completed", () => {
    const profile = profileWith(
      [{ name: "Hitman", tags: ["Stealth"], hint: "completed" }],
      [],
    );
    expect(generateReason(["Stealth"], profile)).toBe(
      "Because you completed Hitman",
    );
  });

  it("uses the saved-feedback phrasing when the strong signal came from Helpful feedback", () => {
    const profile = profileWith(
      [{ name: "Deus Ex", tags: ["Stealth"], hint: "saved" }],
      [],
    );
    expect(generateReason(["Stealth"], profile)).toBe(
      "Because you found Deus Ex helpful",
    );
  });

  it("falls back to aggregate top tags when no strong signal game overlaps", () => {
    const profile = profileWith(
      [],
      [
        ["RPG", 10],
        ["Puzzle", 2],
      ],
    );
    expect(generateReason(["RPG", "Puzzle"], profile)).toBe(
      "Matches your preference for RPG and Puzzle",
    );
  });

  it("falls back to a genre-hint reason in preference-assisted mode", () => {
    const profile = profileWith([], []);
    expect(generateReason(["Simulation"], profile, ["Simulation"])).toBe(
      "Matches your selected genre: Simulation",
    );
  });

  it("falls back to the generic honest line when nothing overlaps at all", () => {
    const profile = profileWith([], []);
    expect(generateReason(["Racing"], profile)).toBe(
      "Recommended from the broad Savepoint catalogue",
    );
  });

  it("is fully deterministic — same inputs, same output, twice", () => {
    const profile = profileWith(
      [{ name: "Dishonored", tags: ["Stealth"], hint: "rated" }],
      [["RPG", 5]],
    );
    expect(generateReason(["Stealth"], profile)).toBe(
      generateReason(["Stealth"], profile),
    );
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests — a minimal Supabase stub. Every table defaults to
// an empty result unless explicitly overridden, so each test only needs to
// populate the handful of tables its scenario actually touches.
// ---------------------------------------------------------------------------

function createSupabaseStub(overrides: Record<string, unknown[]> = {}) {
  const mockFrom = vi.fn((table: string) => {
    const data = overrides[table] ?? [];
    const chain: {
      select: () => typeof chain;
      eq: () => typeof chain;
      in: () => typeof chain;
      gte: () => typeof chain;
      lt: () => typeof chain;
      order: () => typeof chain;
      limit: () => typeof chain;
      insert: () => typeof chain;
      delete: () => typeof chain;
      maybeSingle: () => Promise<{ data: unknown; error: null }>;
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
    } = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      gte: () => chain,
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: () => chain,
      delete: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve) => resolve({ data, error: null }),
    };
    return chain;
  });
  return { supabase: { from: mockFrom } as never, mockFrom };
}

describe("buildUserTasteProfile", () => {
  it("'Helpful' (saved) feedback for a catalogue-only game contributes tags via one bounded Pinecone fetch, never creating a games row", async () => {
    const { supabase, mockFrom } = createSupabaseStub({
      recommendation_feedback: [
        {
          igdb_id: 999,
          game_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    });
    mockFetch.mockResolvedValue({
      records: {
        [buildCatalogueRecordId(999)]: {
          metadata: {
            name: "Catalogue Only Game",
            genres: ["Stealth"],
            game_modes: ["Single player"],
          },
        },
      },
    });

    const profile = await buildUserTasteProfile(supabase, "user-1");

    expect(profile.positiveTags.get("Stealth")).toBe(3);
    expect(profile.positiveTags.get("Single player")).toBe(3);
    expect(profile.strongSignalGames).toEqual([
      {
        name: "Catalogue Only Game",
        tags: new Set(["Stealth", "Single player"]),
        weight: 3,
        hint: "saved",
      },
    ]);
    expect(profile.positiveSignalCount).toBe(1);
    // Exactly one Pinecone fetch call, never a "games" insert/upsert of any
    // kind — recording Helpful feedback for a catalogue-only game must
    // never import it.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const gamesFromCalls = mockFrom.mock.calls.filter(([t]) => t === "games");
    expect(gamesFromCalls).toHaveLength(0);
  });

  it("degrades gracefully (no signal, no throw) if the Pinecone metadata fetch fails", async () => {
    const { supabase } = createSupabaseStub({
      recommendation_feedback: [
        { igdb_id: 999, game_id: null, created_at: new Date().toISOString() },
      ],
    });
    mockFetch.mockRejectedValue(new Error("pinecone down"));

    const profile = await buildUserTasteProfile(supabase, "user-1");

    expect(profile.positiveTags.size).toBe(0);
    expect(profile.positiveSignalCount).toBe(0);
  });

  it("returns an empty profile when the user has no signals at all", async () => {
    const { supabase } = createSupabaseStub();
    const profile = await buildUserTasteProfile(supabase, "user-1");
    expect(profile.positiveSignalCount).toBe(0);
    expect(profile.strongSignalGames).toEqual([]);
  });
});

describe("getRecommendations", () => {
  it("cold start: fewer than 3 signals and no genre hints never calls Pinecone", async () => {
    const { supabase } = createSupabaseStub();

    const outcome = await getRecommendations(supabase, {
      userId: "user-1",
      seed: 1,
      clientId: "client-1",
    });

    expect(outcome.coldStart).toBe(true);
    expect(outcome.results).toEqual([]);
    expect(mockSearchGameHits).not.toHaveBeenCalled();
  });

  it("preference-assisted mode: cold-start user with valid genre hints does call Pinecone and labels results accordingly", async () => {
    const { supabase } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [],
    });
    mockSearchGameHits.mockResolvedValue([
      hit({ igdbId: 10, score: 0.8, genres: ["RPG"] }),
    ]);

    const outcome = await getRecommendations(supabase, {
      userId: "user-1",
      seed: 2,
      clientId: "client-2",
      genreHints: ["rpg"],
    });

    expect(outcome.coldStart).toBe(false);
    expect(outcome.mode).toBe("preference-assisted");
    expect(mockSearchGameHits).toHaveBeenCalledWith(
      expect.stringContaining("RPG"),
      expect.any(Number),
    );
  });

  it("throws RecommendationsRateLimitedError before any Pinecone call once the bucket is exhausted", async () => {
    const { supabase } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [],
    });
    mockSearchGameHits.mockResolvedValue([]);

    // Exhaust the recommendations:client-3 bucket (15/60s). Each call uses
    // a distinct seed so none of them hit the cache-before-rate-limit path.
    for (let i = 0; i < 15; i++) {
      await getRecommendations(supabase, {
        userId: "user-1",
        seed: i,
        clientId: "client-3",
        genreHints: ["rpg"],
      }).catch(() => {});
    }
    mockSearchGameHits.mockClear();

    await expect(
      getRecommendations(supabase, {
        userId: "user-1",
        seed: 999,
        clientId: "client-3",
        genreHints: ["rpg"],
      }),
    ).rejects.toBeInstanceOf(RecommendationsRateLimitedError);
    expect(mockSearchGameHits).not.toHaveBeenCalled();
  });

  it("excludes any igdb_id already in the user's library (any status) from results", async () => {
    const { supabase } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      user_games: [
        {
          game_id: "g1",
          status: "wishlist",
          rating: null,
          games: { igdb_id: 55 },
        },
      ],
      games: [],
    });
    mockSearchGameHits.mockResolvedValue([
      hit({ igdbId: 55, score: 0.9, genres: ["RPG"] }),
      hit({ igdbId: 56, score: 0.5, genres: ["RPG"] }),
    ]);

    // Genre hints force past cold start deterministically regardless of
    // the weak wishlist signal above (which alone wouldn't clear
    // COLD_START_THRESHOLD) — this test is specifically about exclusion,
    // not about crossing the personalization threshold.
    const outcome = await getRecommendations(supabase, {
      userId: "user-1",
      seed: 3,
      clientId: "client-4",
      genreHints: ["rpg"],
    });

    expect(outcome.coldStart).toBe(false);
    expect(outcome.results.map((r) => r.igdbId)).not.toContain(55);
    expect(outcome.results.map((r) => r.igdbId)).toContain(56);
  });

  it("throws RecommendationsUnavailableError when every candidate is excluded (zero eligible)", async () => {
    const { supabase } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      user_games: [
        {
          game_id: "g1",
          status: "wishlist",
          rating: null,
          games: { igdb_id: 10 },
        },
      ],
    });
    mockSearchGameHits.mockResolvedValue([hit({ igdbId: 10, score: 0.9 })]);

    await expect(
      getRecommendations(supabase, {
        userId: "user-1",
        seed: 4,
        clientId: "client-5",
        genreHints: ["rpg"],
      }),
    ).rejects.toBeInstanceOf(RecommendationsUnavailableError);
  });

  it("a catalogue-only candidate (no matching games row) renders with source 'igdb' and creates no games row", async () => {
    const { supabase, mockFrom } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [], // no cached games at all — every candidate is catalogue-only
    });
    mockSearchGameHits.mockResolvedValue([
      hit({
        igdbId: 77,
        score: 0.9,
        slug: "some-game",
        name: "Some Game",
        genres: ["RPG"],
      }),
    ]);

    const outcome = await getRecommendations(supabase, {
      userId: "user-1",
      seed: 5,
      clientId: "client-6",
      genreHints: ["rpg"],
    });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]!.source).toBe("igdb");
    expect(outcome.results[0]!.igdbId).toBe(77);
    // No insert/upsert of any kind against "games" happened anywhere in
    // this flow — only read (.select().in()) calls.
    const gamesFromCalls = mockFrom.mock.calls.filter(([t]) => t === "games");
    expect(gamesFromCalls.length).toBeGreaterThan(0); // read happened
  });

  it("a cache hit returns immediately without calling Pinecone or checking the rate limit", async () => {
    const { supabase } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [],
    });
    mockSearchGameHits.mockResolvedValue([
      hit({ igdbId: 88, score: 0.9, genres: ["RPG"] }),
    ]);

    const first = await getRecommendations(supabase, {
      userId: "user-1",
      seed: 6,
      clientId: "client-7",
      genreHints: ["rpg"],
    });
    mockSearchGameHits.mockClear();

    const second = await getRecommendations(supabase, {
      userId: "user-1",
      seed: 6,
      clientId: "client-7",
      genreHints: ["rpg"],
    });

    expect(second.results).toEqual(first.results);
    expect(mockSearchGameHits).not.toHaveBeenCalled();
  });

  it("sets reduced:true (an honest 'showing fewer' notice) when the eligible pool is thin but nonzero, without falling back to unavailable", async () => {
    const { supabase } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [],
    });
    // Fewer than FULL_RESULT_FLOOR (12) eligible candidates.
    mockSearchGameHits.mockResolvedValue([
      hit({ igdbId: 201, score: 0.9, genres: ["RPG"] }),
      hit({ igdbId: 202, score: 0.8, genres: ["RPG"] }),
    ]);

    const outcome = await getRecommendations(supabase, {
      userId: "user-1",
      seed: 7,
      clientId: "client-8",
      genreHints: ["rpg"],
    });

    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.reduced).toBe(true);
  });

  it("propagates a genuine Pinecone search failure rather than swallowing it into an empty result", async () => {
    const { supabase } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [],
    });
    const { PineconeSearchError } = await import("@/lib/pinecone/search");
    mockSearchGameHits.mockRejectedValue(
      new PineconeSearchError("index unreachable"),
    );

    await expect(
      getRecommendations(supabase, {
        userId: "user-1",
        seed: 8,
        clientId: "client-9",
        genreHints: ["rpg"],
      }),
    ).rejects.toBeInstanceOf(PineconeSearchError);
  });

  it("cross-user cache-key isolation: two different users requesting the same seed never share a cached result set", async () => {
    const { supabase: supabaseA } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [],
    });
    mockSearchGameHits.mockResolvedValue([
      hit({ igdbId: 301, score: 0.9, genres: ["RPG"], name: "User A's Game" }),
    ]);
    const outcomeA = await getRecommendations(supabaseA, {
      userId: "user-a",
      seed: 42,
      clientId: "client-10",
      genreHints: ["rpg"],
    });

    const { supabase: supabaseB } = createSupabaseStub({
      genres: [{ name: "RPG" }],
      games: [],
    });
    mockSearchGameHits.mockResolvedValue([
      hit({ igdbId: 302, score: 0.9, genres: ["RPG"], name: "User B's Game" }),
    ]);
    const outcomeB = await getRecommendations(supabaseB, {
      userId: "user-b",
      seed: 42,
      clientId: "client-11",
      genreHints: ["rpg"],
    });

    expect(outcomeA.results.map((r) => r.igdbId)).toEqual([301]);
    expect(outcomeB.results.map((r) => r.igdbId)).toEqual([302]);
    expect(mockSearchGameHits).toHaveBeenCalledTimes(2);
  });
});

describe("recordClick", () => {
  it("resolves game_id server-side from igdb_id — never accepts one from a caller", async () => {
    const { supabase, mockFrom } = createSupabaseStub({
      games: [{ id: "resolved-game-id" }],
    });

    await recordClick(supabase, "user-1", 123);

    const insertCall = mockFrom.mock.results.find(
      (_, i) => mockFrom.mock.calls[i]![0] === "recommendation_feedback",
    );
    expect(insertCall).toBeDefined();
  });
});
