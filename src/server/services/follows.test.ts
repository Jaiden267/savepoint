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

import { getFollowers, getFollowing, isFollowing } from "./follows";

interface ChainResult {
  data: unknown;
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

const USER_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFollowers / getFollowing pagination", () => {
  it("hasMore is false when exactly a full page (no lookahead row) comes back", async () => {
    const followerIds = Array.from({ length: 24 }, (_, i) => `follower-${i}`);
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "follows") {
        return makeChain({
          data: followerIds.map((id) => ({
            follower_id: id,
            created_at: "2026-01-01T00:00:00Z",
          })),
        });
      }
      if (table === "profiles") return makeChain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getFollowers({ userId: USER_ID, page: 1 });

    expect(result.hasMore).toBe(false);
    expect(result.profiles).toHaveLength(24);
  });

  it("hasMore is true when the lookahead row (pageSize + 1) comes back, and that extra row is trimmed", async () => {
    const followerIds = Array.from({ length: 25 }, (_, i) => `follower-${i}`);
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "follows") {
        return makeChain({
          data: followerIds.map((id) => ({
            follower_id: id,
            created_at: "2026-01-01T00:00:00Z",
          })),
        });
      }
      if (table === "profiles") return makeChain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getFollowers({ userId: USER_ID, page: 1 });

    expect(result.hasMore).toBe(true);
    expect(result.profiles).toHaveLength(24);
  });

  it("getFollowing scopes to follower_id (the viewer), not following_id", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "follows") return chain;
      throw new Error(`unexpected table ${table}`);
    });

    await getFollowing({ userId: USER_ID, page: 1 });

    expect(chain.eq).toHaveBeenCalledWith("follower_id", USER_ID);
  });

  it("getFollowers scopes to following_id (the target), not follower_id", async () => {
    const chain = makeChain({ data: [] });
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "follows") return chain;
      throw new Error(`unexpected table ${table}`);
    });

    await getFollowers({ userId: USER_ID, page: 1 });

    expect(chain.eq).toHaveBeenCalledWith("following_id", USER_ID);
  });

  it("batches profile hydration in a single .in() call regardless of follower count", async () => {
    const followerIds = Array.from({ length: 10 }, (_, i) => `follower-${i}`);
    const profilesChain = makeChain({ data: [] });
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "follows") {
        return makeChain({
          data: followerIds.map((id) => ({
            follower_id: id,
            created_at: "2026-01-01T00:00:00Z",
          })),
        });
      }
      if (table === "profiles") return profilesChain;
      throw new Error(`unexpected table ${table}`);
    });

    await getFollowers({ userId: USER_ID, page: 1 });

    expect(profilesChain.in).toHaveBeenCalledTimes(1);
  });
});

describe("isFollowing", () => {
  it("returns false for a signed-out viewer without querying the database", async () => {
    const result = await isFollowing(null, USER_ID);

    expect(result).toBe(false);
    expect(mockServerFrom).not.toHaveBeenCalled();
  });

  it("returns false for a viewer checking against themselves, without querying the database", async () => {
    const result = await isFollowing(USER_ID, USER_ID);

    expect(result).toBe(false);
    expect(mockServerFrom).not.toHaveBeenCalled();
  });

  it("returns true when a matching follow row exists", async () => {
    mockServerFrom.mockReturnValue(makeChain({ data: { id: "follow-1" } }));

    const result = await isFollowing("viewer-1", USER_ID);

    expect(result).toBe(true);
  });
});
