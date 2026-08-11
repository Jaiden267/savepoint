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

import { getListDetail, getProfileLists, getPopularPublicLists } from "./lists";

interface ChainResult {
  data: unknown;
  error?: unknown;
}

function makeChain(result: ChainResult) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      resolve: (value: ChainResult) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

const LIST_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const OWNER_ID = "owner-1";
const OTHER_VIEWER_ID = "viewer-2";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getListDetail", () => {
  it("returns null for a private list RLS has already filtered out for a non-owner viewer", async () => {
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "lists") return makeChain({ data: null });
      throw new Error(
        `unexpected table ${table} — list_items must never be queried once the list itself came back empty`,
      );
    });

    const result = await getListDetail(LIST_ID, OTHER_VIEWER_ID);

    expect(result).toBeNull();
  });

  it("returns the list with isOwner=true and its items for the owning viewer", async () => {
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "lists") {
        return makeChain({
          data: {
            id: LIST_ID,
            user_id: OWNER_ID,
            title: "My favourites",
            description: null,
            is_ranked: true,
            visibility: "private",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        });
      }
      if (table === "list_items") {
        return makeChain({
          data: [
            {
              id: "item-1",
              game_id: "game-1",
              position: 1,
              note: null,
              games: {
                slug: "game-one",
                name: "Game One",
                cover_image_id: null,
                release_date: null,
              },
            },
          ],
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getListDetail(LIST_ID, OWNER_ID);

    expect(result).not.toBeNull();
    expect(result!.isOwner).toBe(true);
    expect(result!.visibility).toBe("private");
    expect(result!.items).toEqual([
      {
        id: "item-1",
        gameId: "game-1",
        gameSlug: "game-one",
        gameName: "Game One",
        coverImageId: null,
        releaseYear: null,
        position: 1,
        note: null,
      },
    ]);
  });

  it("sets isOwner=false for a signed-out viewer (null) even when the list happens to be readable", async () => {
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "lists") {
        return makeChain({
          data: {
            id: LIST_ID,
            user_id: OWNER_ID,
            title: "Public list",
            description: null,
            is_ranked: false,
            visibility: "public",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        });
      }
      if (table === "list_items") return makeChain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getListDetail(LIST_ID, null);

    expect(result!.isOwner).toBe(false);
  });
});

describe("getProfileLists", () => {
  it("excludes unlisted lists for a non-owner viewer — an application-level narrowing on top of RLS", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockReturnValue(chain);

    await getProfileLists({
      userId: OWNER_ID,
      viewerId: OTHER_VIEWER_ID,
      page: 1,
    });

    expect(chain.eq).toHaveBeenCalledWith("visibility", "public");
  });

  it("does not filter by visibility for the profile's own owner viewing their own tab", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockReturnValue(chain);

    await getProfileLists({ userId: OWNER_ID, viewerId: OWNER_ID, page: 1 });

    expect(chain.eq).not.toHaveBeenCalledWith("visibility", "public");
  });

  it("filters by visibility for a signed-out viewer (null)", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockReturnValue(chain);

    await getProfileLists({ userId: OWNER_ID, viewerId: null, page: 1 });

    expect(chain.eq).toHaveBeenCalledWith("visibility", "public");
  });
});

describe("automated proxy for the manual two-user/one-private-list checklist", () => {
  // The real live-browser two-user checklist (docs/SOCIAL.md) is run
  // manually by the project owner — this is its automated proxy, not a
  // replacement: it mocks the PostgREST response RLS would actually
  // produce (an empty/absent row) for "User B requests User A's private
  // list" and asserts this service layer correctly treats that as
  // not-found/absent, never as an error or a leak.
  it("User B's request for User A's private list returns null (not-found), not an error", async () => {
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "lists") return makeChain({ data: null }); // RLS already filtered this out for User B
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getListDetail(LIST_ID, OTHER_VIEWER_ID);

    expect(result).toBeNull();
  });

  it("User A's private list is absent from User B's view of User A's Lists tab", async () => {
    const chain = makeChain({ data: [] }); // RLS + the visibility=public narrowing both apply
    mockServerFrom.mockReturnValue(chain);

    const result = await getProfileLists({
      userId: OWNER_ID,
      viewerId: OTHER_VIEWER_ID,
      page: 1,
    });

    expect(result.lists).toEqual([]);
    expect(chain.eq).toHaveBeenCalledWith("visibility", "public");
  });
});

describe("getPopularPublicLists", () => {
  it("filters to visibility=public and orders by item_count descending", async () => {
    const listChain = makeChain({ data: [] });
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "list_public_summary") return listChain;
      throw new Error(`unexpected table ${table}`);
    });

    await getPopularPublicLists({ page: 1 });

    expect(listChain.eq).toHaveBeenCalledWith("visibility", "public");
    expect(listChain.order).toHaveBeenCalledWith(
      "item_count",
      expect.objectContaining({ ascending: false }),
    );
  });

  it("batches author profile hydration in a single .in() call, never one query per list", async () => {
    const listChain = makeChain({
      data: [
        {
          id: "list-1",
          user_id: "author-1",
          title: "List one",
          description: null,
          is_ranked: false,
          visibility: "public",
          item_count: 5,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "list-2",
          user_id: "author-2",
          title: "List two",
          description: null,
          is_ranked: false,
          visibility: "public",
          item_count: 3,
          created_at: "2026-01-02T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ],
    });
    const profilesChain = makeChain({
      data: [
        {
          id: "author-1",
          username: "alice",
          display_name: null,
          avatar_path: null,
        },
        {
          id: "author-2",
          username: "bob",
          display_name: null,
          avatar_path: null,
        },
      ],
    });

    mockServerFrom.mockImplementation((table: string) => {
      if (table === "list_public_summary") return listChain;
      if (table === "profiles") return profilesChain;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getPopularPublicLists({ page: 1 });

    expect(profilesChain.in).toHaveBeenCalledTimes(1);
    expect(result.lists).toHaveLength(2);
    expect(result.lists[0]!.author.username).toBe("alice");
    expect(result.lists[1]!.author.username).toBe("bob");
  });
});
