import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockServerFrom } = vi.hoisted(() => ({
  mockServerFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ from: mockServerFrom }),
}));

import {
  getProfileByUsername,
  getRecentlyPlayed,
  getFavouriteGames,
  getRatingDistribution,
} from "./profile";

interface ChainResult {
  data: unknown;
}

function makeChain(result: ChainResult) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
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

const USER_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProfileByUsername", () => {
  it("returns null for a missing username", async () => {
    mockServerFrom.mockReturnValue(makeChain({ data: null }));

    const result = await getProfileByUsername("nobody");

    expect(result).toBeNull();
  });

  it("maps the row to camelCase fields", async () => {
    mockServerFrom.mockReturnValue(
      makeChain({
        data: {
          id: USER_ID,
          username: "alice",
          display_name: "Alice",
          bio: "hi",
          avatar_path: "avatars/alice.png",
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    );

    const result = await getProfileByUsername("alice");

    expect(result).toEqual({
      id: USER_ID,
      username: "alice",
      displayName: "Alice",
      bio: "hi",
      avatarPath: "avatars/alice.png",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });
});

describe("getRecentlyPlayed", () => {
  it("dedupes repeat playthroughs of the same game, keeping only the most recent", async () => {
    mockServerFrom.mockReturnValue(
      makeChain({
        data: [
          {
            played_on: "2026-01-03",
            games: {
              id: "game-1",
              slug: "game-one",
              name: "Game One",
              cover_image_id: null,
            },
          },
          {
            played_on: "2026-01-02",
            games: {
              id: "game-1",
              slug: "game-one",
              name: "Game One",
              cover_image_id: null,
            },
          },
          {
            played_on: "2026-01-01",
            games: {
              id: "game-2",
              slug: "game-two",
              name: "Game Two",
              cover_image_id: null,
            },
          },
        ],
      }),
    );

    const result = await getRecentlyPlayed(USER_ID);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      gameId: "game-1",
      playedOn: "2026-01-03",
    });
    expect(result[1]).toMatchObject({ gameId: "game-2" });
  });
});

describe("getFavouriteGames", () => {
  it("excludes unrated games and orders by rating descending", async () => {
    const chain = makeChain({
      data: [
        {
          rating: 10,
          games: {
            id: "game-1",
            slug: "game-one",
            name: "Game One",
            cover_image_id: null,
          },
        },
      ],
    });
    mockServerFrom.mockReturnValue(chain);

    const result = await getFavouriteGames(USER_ID);

    expect(chain.not).toHaveBeenCalledWith("rating", "is", null);
    expect(chain.order).toHaveBeenCalledWith(
      "rating",
      expect.objectContaining({ ascending: false }),
    );
    expect(result[0]).toMatchObject({ gameId: "game-1", rating: 5 });
  });
});

describe("getRatingDistribution", () => {
  it("returns buckets from the user_rating_distribution view, filtered by userId", async () => {
    const chain = makeChain({
      data: [
        { rating: 10, game_count: 3 },
        { rating: 8, game_count: 1 },
      ],
    });
    mockServerFrom.mockImplementation((table: string) => {
      if (table !== "user_rating_distribution") {
        throw new Error(`unexpected table ${table}`);
      }
      return chain;
    });

    const result = await getRatingDistribution(USER_ID);

    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(result).toEqual([
      { dbRating: 10, gameCount: 3 },
      { dbRating: 8, gameCount: 1 },
    ]);
  });
});
