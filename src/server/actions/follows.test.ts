import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

const TARGET_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";

const { mockGetUser, mockInsert, mockDelete, mockFrom, mockRevalidatePath } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockInsert: vi.fn(),
    mockDelete: vi.fn(),
    mockFrom: vi.fn(),
    mockRevalidatePath: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    }),
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { toggleFollowAction } from "./follows";

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const user = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockGetUser.mockResolvedValue({ data: { user } });
});

describe("toggleFollowAction", () => {
  it("validates its arguments before any auth check or database call", async () => {
    const result = await toggleFollowAction("not-a-uuid", true, "alice");

    expect(result.status).toBe("error");
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects following yourself, before any database call", async () => {
    // The authenticated caller and the follow target must be the exact same
    // (valid-uuid) id for this to reach the self-follow check rather than
    // failing schema validation first.
    mockGetUser.mockResolvedValue({ data: { user: { id: TARGET_ID } } });

    const result = await toggleFollowAction(TARGET_ID, true, "self");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/yourself/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns a sign-in error for an unauthenticated caller, without redirecting", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await toggleFollowAction(TARGET_ID, true, "alice");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/sign in/i);
  });

  it("treats a 23505 on insert (already following) as idempotent success", async () => {
    const followChain = makeChain({
      error: { code: "23505", message: "duplicate key" },
    });
    mockInsert.mockReturnValue(followChain);
    const countChain = makeChain({ count: 4 });
    mockFrom.mockImplementation((table: string) => {
      if (table !== "follows") throw new Error(`unexpected table ${table}`);
      return { insert: mockInsert, select: () => countChain };
    });

    const result = await toggleFollowAction(TARGET_ID, true, "alice");

    expect(result.status).toBe("success");
    expect(result.following).toBe(true);
  });

  it("treats deleting 0 rows (already not following) as idempotent success", async () => {
    const followChain = makeChain({ error: null });
    mockDelete.mockReturnValue(followChain);
    const countChain = makeChain({ count: 0 });
    mockFrom.mockImplementation((table: string) => {
      if (table !== "follows") throw new Error(`unexpected table ${table}`);
      return { delete: mockDelete, select: () => countChain };
    });

    const result = await toggleFollowAction(TARGET_ID, false, "alice");

    expect(result.status).toBe("success");
    expect(result.following).toBe(false);
  });

  it("scopes the unfollow delete to the authenticated user's own follow row", async () => {
    const followChain = makeChain({ error: null });
    mockDelete.mockReturnValue(followChain);
    const countChain = makeChain({ count: 0 });
    mockFrom.mockImplementation((table: string) => {
      if (table !== "follows") throw new Error(`unexpected table ${table}`);
      return { delete: mockDelete, select: () => countChain };
    });

    await toggleFollowAction(TARGET_ID, false, "alice");

    expect(followChain.eq).toHaveBeenCalledWith("follower_id", "user-1");
    expect(followChain.eq).toHaveBeenCalledWith("following_id", TARGET_ID);
  });

  it("revalidates the target's profile pages only when a username is provided", async () => {
    const followChain = makeChain({ error: null });
    mockInsert.mockReturnValue(followChain);
    const countChain = makeChain({ count: 1 });
    mockFrom.mockImplementation((table: string) => {
      if (table !== "follows") throw new Error(`unexpected table ${table}`);
      return { insert: mockInsert, select: () => countChain };
    });

    await toggleFollowAction(TARGET_ID, true, null);

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
