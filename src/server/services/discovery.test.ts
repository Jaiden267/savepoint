import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockServerFrom, mockGetPublicUrl } = vi.hoisted(() => ({
  mockServerFrom: vi.fn(),
  mockGetPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://avatar" } })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      from: mockServerFrom,
      storage: { from: () => ({ getPublicUrl: mockGetPublicUrl }) },
    }),
}));

import { searchProfiles, getRecentPublicReviews } from "./discovery";

interface ChainResult {
  data: unknown;
}

function makeChain(result: ChainResult) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    in: vi.fn(() => chain),
    then: (
      resolve: (value: ChainResult) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchProfiles", () => {
  it("only ever selects public profile fields", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockReturnValue(chain);

    await searchProfiles({ query: "alice", page: 1 });

    expect(chain.select).toHaveBeenCalledWith(
      "id, username, display_name, avatar_path, bio",
    );
  });

  it("quotes the search pattern for the .or() filter so commas/parens in a query can't corrupt it", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockReturnValue(chain);

    await searchProfiles({ query: "a,b)c", page: 1 });

    const orFilter = (chain.or.mock.calls[0] as unknown as [string])[0];
    expect(orFilter).toContain('"%a,b)c%"');
  });

  it("returns mapped results with hasMore derived from the lookahead row", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `user-${i}`,
      username: `user${i}`,
      display_name: null,
      avatar_path: null,
      bio: null,
    }));
    mockServerFrom.mockReturnValue(makeChain({ data: rows }));

    const result = await searchProfiles({ query: "user", page: 1 });

    expect(result.hasMore).toBe(true);
    expect(result.profiles).toHaveLength(24);
  });
});

describe("getRecentPublicReviews", () => {
  it("batches game slug lookups in a single .in() call, never one query per review", async () => {
    const reviewRows = [1, 2, 3].map((n) => ({
      id: `review-${n}`,
      user_id: `author-${n}`,
      game_id: `game-${n}`,
      rating: 8,
      body: `Body ${n}`,
      has_spoilers: false,
      created_at: "2026-01-01T00:00:00Z",
    }));
    const gamesChain = makeChain({
      data: [1, 2, 3].map((n) => ({ id: `game-${n}`, slug: `game-slug-${n}` })),
    });
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "reviews") return makeChain({ data: reviewRows });
      if (table === "games") return gamesChain;
      if (table === "profiles") return makeChain({ data: [] });
      if (table === "review_like_counts") return makeChain({ data: [] });
      if (table === "review_likes") return makeChain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getRecentPublicReviews({ page: 1 });

    expect(result.reviews).toHaveLength(3);
    expect(gamesChain.in).toHaveBeenCalledTimes(1);
    expect(result.reviews.map((r) => r.review.gameSlug).sort()).toEqual([
      "game-slug-1",
      "game-slug-2",
      "game-slug-3",
    ]);
  });

  it("orders by created_at descending — most recent review first", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "reviews") return chain;
      throw new Error(`unexpected table ${table}`);
    });

    await getRecentPublicReviews({ page: 1 });

    expect(chain.order).toHaveBeenCalledWith(
      "created_at",
      expect.objectContaining({ ascending: false }),
    );
  });
});
