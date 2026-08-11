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

import { getHomeFeed } from "./activity-feed";

interface ChainResult {
  data: unknown;
}

function makeChain(result: ChainResult) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {
    __calls: calls,
  };
  for (const method of ["select", "eq", "in", "order", "limit", "or"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.then = (
    resolve: (value: ChainResult) => void,
    reject?: (reason: unknown) => void,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain as Record<string, ReturnType<typeof vi.fn>> & {
    __calls: { method: string; args: unknown[] }[];
  };
}

const VIEWER_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const FOLLOWED_ID = "5ee2dfc9-4557-5278-b5c8-285b9f0f1b69";

function activityEventRow(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "event-1",
    actor_id: FOLLOWED_ID,
    event_type: "game_completed",
    object_type: "user_game",
    object_id: "obj-1",
    game_id: "game-1",
    metadata: {},
    created_at: "2026-01-05T00:00:00Z",
    ...overrides,
  };
}

/**
 * Builds a mockServerFrom implementation from a per-table result map,
 * defaulting unlisted tables to empty results. A table's value may be a
 * single ChainResult (reused for every call to that table) or an array of
 * ChainResults consumed in call order — needed because getHomeFeed queries
 * "follows" twice for different reasons (the viewer's own following list,
 * and — for a follow_created event — the object existence check).
 */
function makeFromDispatcher(
  overrides: Record<string, ChainResult | ChainResult[]>,
) {
  const chainsByTable: Record<string, ReturnType<typeof makeChain>[]> = {};
  const callIndexByTable: Record<string, number> = {};
  const dispatcher = vi.fn((table: string) => {
    const override = overrides[table];
    let result: ChainResult;
    if (Array.isArray(override)) {
      const index = callIndexByTable[table] ?? 0;
      result = override[Math.min(index, override.length - 1)] ?? { data: [] };
      callIndexByTable[table] = index + 1;
    } else {
      result = override ?? { data: [] };
    }
    const chain = makeChain(result);
    chainsByTable[table] = chainsByTable[table] ?? [];
    chainsByTable[table]!.push(chain);
    return chain;
  });
  return { dispatcher, chainsByTable };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getHomeFeed", () => {
  it("returns an empty feed without querying activity_events when the viewer follows no one", async () => {
    const { dispatcher } = makeFromDispatcher({
      follows: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(dispatcher).not.toHaveBeenCalledWith("activity_events");
  });

  it("scopes activity_events strictly to followed actor ids", async () => {
    const { dispatcher, chainsByTable } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [] },
      games: { data: [] },
      profiles: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    await getHomeFeed({ viewerId: VIEWER_ID });

    const eventsChain = chainsByTable.activity_events![0]!;
    expect(eventsChain.in).toHaveBeenCalledWith("actor_id", [FOLLOWED_ID]);
  });

  it("surfaces a game_completed event from a followed user with the game hydrated", async () => {
    const row = activityEventRow({});
    const { dispatcher } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [row] },
      user_games: { data: [{ id: "obj-1" }] },
      games: {
        data: [
          {
            id: "game-1",
            slug: "some-game",
            name: "Some Game",
            cover_image_id: null,
          },
        ],
      },
      profiles: {
        data: [
          {
            id: FOLLOWED_ID,
            username: "alice",
            display_name: null,
            avatar_path: null,
          },
        ],
      },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      eventType: "game_completed",
      game: { slug: "some-game" },
      actor: { username: "alice" },
    });
  });

  it("suppresses a list_created event whose list has since gone private", async () => {
    const row = activityEventRow({
      event_type: "list_created",
      object_type: "list",
      object_id: "list-1",
      game_id: null,
      metadata: { title: "My List", is_ranked: false },
    });
    const { dispatcher } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [row] },
      lists: { data: [{ id: "list-1", visibility: "private" }] },
      profiles: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toEqual([]);
  });

  it("suppresses a list_created event whose list has since gone unlisted (readable by direct link, but not surfaced in the feed)", async () => {
    const row = activityEventRow({
      event_type: "list_created",
      object_type: "list",
      object_id: "list-1",
      game_id: null,
      metadata: { title: "My List", is_ranked: false },
    });
    const { dispatcher } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [row] },
      lists: { data: [{ id: "list-1", visibility: "unlisted" }] },
      profiles: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toEqual([]);
  });

  it("surfaces a list_created event whose list is still public", async () => {
    const row = activityEventRow({
      event_type: "list_created",
      object_type: "list",
      object_id: "list-1",
      game_id: null,
      metadata: { title: "My List", is_ranked: true },
    });
    const { dispatcher } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [row] },
      lists: { data: [{ id: "list-1", visibility: "public" }] },
      profiles: {
        data: [
          {
            id: FOLLOWED_ID,
            username: "alice",
            display_name: null,
            avatar_path: null,
          },
        ],
      },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      eventType: "list_created",
      title: "My List",
      isRanked: true,
    });
  });

  it("suppresses a review_published event whose review was deleted after publication", async () => {
    const row = activityEventRow({
      event_type: "review_published",
      object_type: "review",
      object_id: "review-1",
      game_id: "game-1",
      metadata: { rating: 8, has_spoilers: false },
    });
    const { dispatcher } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [row] },
      reviews: { data: [] }, // deleted — existence check finds nothing
      profiles: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toEqual([]);
  });

  it("suppresses a follow_created event whose follow was since undone (unfollowed)", async () => {
    const row = activityEventRow({
      event_type: "follow_created",
      object_type: "follow",
      object_id: "follow-1",
      game_id: null,
      metadata: { following_id: "someone-else" },
    });
    // "follows" is queried twice for different reasons here: first for the
    // viewer's own following list (must return FOLLOWED_ID so the raw
    // activity_events fetch proceeds), then for the follow_created event's
    // object existence check (empty — the follow row no longer exists,
    // i.e. it was unfollowed after the event was logged).
    const { dispatcher } = makeFromDispatcher({
      follows: [{ data: [{ following_id: FOLLOWED_ID }] }, { data: [] }],
      activity_events: { data: [row] },
      profiles: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toEqual([]);
  });

  it("surfaces a follow_created event whose follow still exists", async () => {
    const row = activityEventRow({
      event_type: "follow_created",
      object_type: "follow",
      object_id: "follow-1",
      game_id: null,
      metadata: { following_id: "someone-else" },
    });
    const { dispatcher } = makeFromDispatcher({
      follows: [
        { data: [{ following_id: FOLLOWED_ID }] },
        { data: [{ id: "follow-1" }] },
      ],
      activity_events: { data: [row] },
      profiles: {
        data: [
          {
            id: FOLLOWED_ID,
            username: "alice",
            display_name: null,
            avatar_path: null,
          },
          {
            id: "someone-else",
            username: "carol",
            display_name: null,
            avatar_path: null,
          },
        ],
      },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      eventType: "follow_created",
      followedUser: { username: "carol" },
    });
  });

  it("derives the next cursor from the raw page's last row, not the last surviving (rendered) row", async () => {
    // Two raw rows returned (equal to pageSize=2, so hasMore is only true if
    // a lookahead row beyond that is present) — set pageSize=1 so the second
    // raw row is the lookahead, and the *kept* page is just the first row,
    // which is itself suppressed (its game was removed).
    const keptRow = activityEventRow({
      id: "6ff3e0da-5668-4389-8c6d-9396c0a1c2c7",
      created_at: "2026-01-05T00:00:00Z",
      game_id: null, // no game hydrated -> falls through every branch -> suppressed by the switch, not by the existence-check step
    });
    const lookaheadRow = activityEventRow({
      id: "7aa4f1eb-6779-449a-9d7e-a4a7d1b2d3e4",
      created_at: "2026-01-04T00:00:00Z",
    });
    const { dispatcher } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [keptRow, lookaheadRow] },
      user_games: { data: [{ id: "obj-1" }] },
      games: { data: [] },
      profiles: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID, pageSize: 1 });

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();

    // Round-trip: calling again with that cursor must filter strictly
    // before the *kept* row's own created_at/id, not the lookahead row's —
    // confirming the cursor was derived from the raw page's last kept row.
    const { dispatcher: dispatcher2, chainsByTable: chains2 } =
      makeFromDispatcher({
        follows: { data: [{ following_id: FOLLOWED_ID }] },
        activity_events: { data: [] },
      });
    mockServerFrom.mockImplementation(dispatcher2);

    await getHomeFeed({
      viewerId: VIEWER_ID,
      pageSize: 1,
      cursor: result.nextCursor,
    });

    const secondCallOrArgs = chains2.activity_events![0]!.__calls.find(
      (c) => c.method === "or",
    )?.args[0] as string;
    expect(secondCallOrArgs).toContain(keptRow.created_at);
    expect(secondCallOrArgs).not.toContain(lookaheadRow.created_at);
  });

  it("resets to page 1 (no cursor filter applied) for a malformed cursor, rather than throwing", async () => {
    const { dispatcher, chainsByTable } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: [] },
    });
    mockServerFrom.mockImplementation(dispatcher);

    await expect(
      getHomeFeed({ viewerId: VIEWER_ID, cursor: "not-valid-base64!!" }),
    ).resolves.toBeDefined();

    const orCalls = chainsByTable.activity_events![0]!.__calls.filter(
      (c) => c.method === "or",
    );
    expect(orCalls).toHaveLength(0);
  });

  it("batches object-type existence checks in a single .in() call each, never one query per event", async () => {
    const rows = [1, 2, 3].map((n) =>
      activityEventRow({
        id: `event-${n}`,
        event_type: "review_published",
        object_type: "review",
        object_id: `review-${n}`,
        game_id: "game-1",
        metadata: { rating: 6, has_spoilers: false },
      }),
    );
    const { dispatcher, chainsByTable } = makeFromDispatcher({
      follows: { data: [{ following_id: FOLLOWED_ID }] },
      activity_events: { data: rows },
      reviews: {
        data: [1, 2, 3].map((n) => ({ id: `review-${n}`, body: `Body ${n}` })),
      },
      games: {
        data: [
          {
            id: "game-1",
            slug: "some-game",
            name: "Some Game",
            cover_image_id: null,
          },
        ],
      },
      profiles: {
        data: [
          {
            id: FOLLOWED_ID,
            username: "alice",
            display_name: null,
            avatar_path: null,
          },
        ],
      },
    });
    mockServerFrom.mockImplementation(dispatcher);

    const result = await getHomeFeed({ viewerId: VIEWER_ID });

    expect(result.items).toHaveLength(3);
    expect(chainsByTable.reviews).toHaveLength(1); // one .from("reviews") call total
    expect(chainsByTable.reviews![0]!.in).toHaveBeenCalledTimes(1);
  });
});
