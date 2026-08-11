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

import { getGameSocialData } from "./game-social";

interface ChainResult {
  data: unknown;
}

function makeChain(result: ChainResult) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      resolve: (value: ChainResult) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

const GAME_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const GAME_SLUG = "the-legend-of-zelda";
const VIEWER_ID = "viewer-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGameSocialData", () => {
  it("batches Tier 1 queries for a signed-in viewer and returns the aggregated shape", async () => {
    let reviewsCallCount = 0;
    const chains: Record<string, ReturnType<typeof makeChain>[]> = {};

    mockServerFrom.mockImplementation((table: string) => {
      let chain: ReturnType<typeof makeChain>;
      if (table === "user_games") {
        chain = makeChain({ data: { status: "playing", rating: 7 } });
      } else if (table === "diary_entries") {
        chain = makeChain({
          data: [
            {
              id: "entry-1",
              played_on: "2026-01-01",
              rating: 8,
              is_replay: false,
              note: null,
            },
          ],
        });
      } else if (table === "reviews") {
        reviewsCallCount++;
        chain =
          reviewsCallCount === 1
            ? makeChain({
                data: {
                  id: "own-review",
                  rating: 9,
                  body: "Great game",
                  has_spoilers: false,
                },
              })
            : makeChain({
                data: [
                  {
                    id: "review-1",
                    user_id: "author-1",
                    rating: 10,
                    body: "Amazing",
                    has_spoilers: false,
                    created_at: "2026-01-02T00:00:00Z",
                  },
                ],
              });
      } else if (table === "game_rating_stats") {
        chain = makeChain({ data: { average_rating: 7.34, rating_count: 12 } });
      } else if (table === "profiles") {
        chain = makeChain({
          data: [
            {
              id: "author-1",
              username: "author",
              display_name: null,
              avatar_path: null,
            },
          ],
        });
      } else if (table === "review_like_counts") {
        chain = makeChain({ data: [{ review_id: "review-1", like_count: 3 }] });
      } else if (table === "review_likes") {
        chain = makeChain({ data: [{ review_id: "review-1" }] });
      } else {
        chain = makeChain({ data: null });
      }
      chains[table] = chains[table] ?? [];
      chains[table].push(chain);
      return chain;
    });

    const result = await getGameSocialData(GAME_ID, GAME_SLUG, VIEWER_ID);

    expect(result.userGame).toEqual({ status: "playing", rating: 3.5 });
    expect(result.recentDiaryEntries).toEqual([
      {
        id: "entry-1",
        playedOn: "2026-01-01",
        rating: 4,
        isReplay: false,
        note: null,
      },
    ]);
    expect(result.ownReview).toEqual({
      id: "own-review",
      rating: 4.5,
      body: "Great game",
      hasSpoilers: false,
    });
    expect(result.ratingStats).toEqual({ averageStars: 3.67, ratingCount: 12 });
    expect(result.recentReviews).toHaveLength(1);
    expect(result.recentReviews[0]).toMatchObject({
      likeCount: 3,
      viewerHasLiked: true,
      author: { username: "author" },
    });

    // The recent-reviews query is the second .from("reviews") call — it must
    // exclude the viewer's own review when signed in.
    const recentReviewsChain = chains.reviews[1];
    expect(recentReviewsChain.neq).toHaveBeenCalledWith("user_id", VIEWER_ID);

    // Batched, never per-row: exactly one .in() call each for profiles and
    // review_like_counts, regardless of how many reviews were returned.
    expect(chains.profiles[0].in).toHaveBeenCalledTimes(1);
    expect(chains.review_like_counts[0].in).toHaveBeenCalledTimes(1);
  });

  it("skips viewer-scoped queries and the .neq exclusion entirely when signed out", async () => {
    const calledTables: string[] = [];
    let reviewsChain: ReturnType<typeof makeChain> | null = null;

    mockServerFrom.mockImplementation((table: string) => {
      calledTables.push(table);
      if (table === "reviews") {
        reviewsChain = makeChain({
          data: [
            {
              id: "review-1",
              user_id: "author-1",
              rating: 6,
              body: "Solid",
              has_spoilers: false,
              created_at: "2026-01-02T00:00:00Z",
            },
          ],
        });
        return reviewsChain;
      }
      if (table === "game_rating_stats") {
        return makeChain({ data: { average_rating: 5, rating_count: 4 } });
      }
      if (table === "profiles") {
        return makeChain({
          data: [
            {
              id: "author-1",
              username: "author",
              display_name: null,
              avatar_path: null,
            },
          ],
        });
      }
      if (table === "review_like_counts") {
        return makeChain({ data: [{ review_id: "review-1", like_count: 0 }] });
      }
      return makeChain({ data: null });
    });

    const result = await getGameSocialData(GAME_ID, GAME_SLUG, null);

    expect(result.userGame).toBeNull();
    expect(result.recentDiaryEntries).toEqual([]);
    expect(result.ownReview).toBeNull();
    expect(result.recentReviews[0].viewerHasLiked).toBe(false);

    // Signed-out: never touches user_games, diary_entries, or review_likes —
    // there's no viewer to scope those to.
    expect(calledTables).not.toContain("user_games");
    expect(calledTables).not.toContain("diary_entries");
    expect(calledTables).not.toContain("review_likes");

    // Only one .from("reviews") call (recent reviews) — no own-review lookup
    // — and it never excludes anyone by user_id.
    expect(reviewsChain).not.toBeNull();
    expect(reviewsChain!.neq).not.toHaveBeenCalled();
  });
});
