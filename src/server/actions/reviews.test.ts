import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialActionState } from "@/lib/action-state";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const reviewId = "5ee2dfc9-4557-5278-b5c8-285b9f0f1b69";
const commentId = "6ff3e0da-5668-4389-8c6d-9396c0a1c2c7";
const gameSlug = "the-legend-of-zelda";

const {
  mockGetUser,
  mockInsert,
  mockUpdate,
  mockDelete,
  mockFrom,
  mockRevalidatePath,
  mockRedirect,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockRevalidatePath = vi.fn();
  const mockRedirect = vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();
  const mockFrom = vi.fn();

  return {
    mockGetUser,
    mockInsert,
    mockUpdate,
    mockDelete,
    mockFrom,
    mockRevalidatePath,
    mockRedirect,
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
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import {
  createReviewAction,
  updateReviewAction,
  deleteReviewAction,
  toggleReviewLikeAction,
  createReviewCommentAction,
  updateReviewCommentAction,
  deleteReviewCommentAction,
} from "./reviews";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain as {
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

describe("review actions", () => {
  const user = { id: "user-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user } });
  });

  describe("createReviewAction", () => {
    beforeEach(() => {
      mockInsert.mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });
    });

    it("redirects unauthenticated callers instead of touching the database", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await expect(
        createReviewAction(
          initialActionState,
          formData({ gameId, gameSlug, rating: "4", body: "Great game." }),
        ),
      ).rejects.toThrow("REDIRECT:/login");

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("rejects a missing rating without touching the database", async () => {
      const result = await createReviewAction(
        initialActionState,
        formData({ gameId, gameSlug, rating: "", body: "Great game." }),
      );

      expect(result.status).toBe("error");
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("never touches user_games — a review's rating is an independent snapshot", async () => {
      await createReviewAction(
        initialActionState,
        formData({ gameId, gameSlug, rating: "4", body: "Great game." }),
      );

      expect(mockFrom).toHaveBeenCalledWith("reviews");
      expect(mockFrom).not.toHaveBeenCalledWith("user_games");
    });

    it("maps a 23505 unique violation to a friendly duplicate-review message, never raw Postgres text", async () => {
      mockInsert.mockResolvedValue({
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "reviews_user_id_game_id_key"',
        },
      });

      const result = await createReviewAction(
        initialActionState,
        formData({ gameId, gameSlug, rating: "4", body: "Great game." }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toMatch(/already have a review/i);
      expect(result.message).not.toMatch(/constraint/i);
    });

    it("revalidates the game page on success", async () => {
      const result = await createReviewAction(
        initialActionState,
        formData({ gameId, gameSlug, rating: "4", body: "Great game." }),
      );

      expect(result.status).toBe("success");
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/games/${gameSlug}`);
    });
  });

  describe("updateReviewAction", () => {
    let chain: ReturnType<typeof makeChain>;

    beforeEach(() => {
      chain = makeChain({ error: null });
      mockUpdate.mockReturnValue(chain);
      mockFrom.mockReturnValue({ update: mockUpdate });
    });

    it("never includes a game_id field in the update payload", async () => {
      await updateReviewAction(
        initialActionState,
        formData({ reviewId, gameSlug, rating: "3.5", body: "Updated." }),
      );

      const [payload] = mockUpdate.mock.calls[0] as [Record<string, unknown>];
      expect("game_id" in payload).toBe(false);
    });

    it("never touches user_games — editing a review never moves the aggregate score", async () => {
      await updateReviewAction(
        initialActionState,
        formData({ reviewId, gameSlug, rating: "3.5", body: "Updated." }),
      );

      expect(mockFrom).not.toHaveBeenCalledWith("user_games");
    });

    it("scopes the update to the authenticated user's own row", async () => {
      await updateReviewAction(
        initialActionState,
        formData({ reviewId, gameSlug, rating: "3.5", body: "Updated." }),
      );

      expect(chain.eq).toHaveBeenCalledWith("id", reviewId);
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    });

    it("revalidates both the game page and the review page", async () => {
      await updateReviewAction(
        initialActionState,
        formData({ reviewId, gameSlug, rating: "3.5", body: "Updated." }),
      );

      expect(mockRevalidatePath).toHaveBeenCalledWith(`/games/${gameSlug}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/reviews/${reviewId}`);
    });
  });

  describe("deleteReviewAction", () => {
    it("redirects to the game page after deleting, and revalidates both the game and review pages", async () => {
      const chain = makeChain({ data: [{ id: reviewId }], error: null });
      mockDelete.mockReturnValue(chain);
      mockFrom.mockReturnValue({ delete: mockDelete });

      await expect(
        deleteReviewAction(
          initialActionState,
          formData({ reviewId, gameSlug }),
        ),
      ).rejects.toThrow(`REDIRECT:/games/${gameSlug}`);

      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(chain.select).toHaveBeenCalledWith("id");
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/games/${gameSlug}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/reviews/${reviewId}`);
    });

    it("returns a friendly failure and never redirects when the delete affects zero rows", async () => {
      const chain = makeChain({ data: [], error: null });
      mockDelete.mockReturnValue(chain);
      mockFrom.mockReturnValue({ delete: mockDelete });

      const result = await deleteReviewAction(
        initialActionState,
        formData({ reviewId, gameSlug }),
      );

      expect(result.status).toBe("error");
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("returns a friendly failure and never redirects on a database error", async () => {
      const chain = makeChain({
        data: null,
        error: { code: "XX000", message: "internal error" },
      });
      mockDelete.mockReturnValue(chain);
      mockFrom.mockReturnValue({ delete: mockDelete });

      const result = await deleteReviewAction(
        initialActionState,
        formData({ reviewId, gameSlug }),
      );

      expect(result.status).toBe("error");
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("toggleReviewLikeAction", () => {
    it("validates its arguments before any database call, rejecting a malformed reviewId", async () => {
      const result = await toggleReviewLikeAction("not-a-uuid", true, gameSlug);

      expect(result.status).toBe("error");
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it("returns a sign-in error for an unauthenticated caller, without redirecting", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const result = await toggleReviewLikeAction(reviewId, true, gameSlug);

      expect(result.status).toBe("error");
      expect(result.message).toMatch(/sign in/i);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("treats a 23505 on insert (already liked) as success, preventing a duplicate like gracefully", async () => {
      const likesChain = makeChain({
        error: { code: "23505", message: "duplicate key" },
      });
      const countsChain = makeChain({ data: { like_count: 3 }, error: null });
      mockInsert.mockReturnValue(likesChain);
      mockFrom.mockImplementation((table: string) => {
        if (table === "review_likes") return { insert: mockInsert };
        if (table === "review_like_counts")
          return { select: () => countsChain };
        throw new Error(`unexpected table ${table}`);
      });

      const result = await toggleReviewLikeAction(reviewId, true, gameSlug);

      expect(result.status).toBe("success");
      expect(result.liked).toBe(true);
      expect(result.likeCount).toBe(3);
    });

    it("treats deleting 0 rows (already unliked) as success — naturally idempotent", async () => {
      const likesChain = makeChain({ error: null });
      const countsChain = makeChain({ data: { like_count: 0 }, error: null });
      mockDelete.mockReturnValue(likesChain);
      mockFrom.mockImplementation((table: string) => {
        if (table === "review_likes") return { delete: mockDelete };
        if (table === "review_like_counts")
          return { select: () => countsChain };
        throw new Error(`unexpected table ${table}`);
      });

      const result = await toggleReviewLikeAction(reviewId, false, gameSlug);

      expect(result.status).toBe("success");
      expect(result.liked).toBe(false);
      expect(result.likeCount).toBe(0);
    });

    it("revalidates the game page only when a gameSlug is provided", async () => {
      const likesChain = makeChain({ error: null });
      const countsChain = makeChain({ data: { like_count: 1 }, error: null });
      mockInsert.mockReturnValue(likesChain);
      mockFrom.mockImplementation((table: string) => {
        if (table === "review_likes") return { insert: mockInsert };
        if (table === "review_like_counts")
          return { select: () => countsChain };
        throw new Error(`unexpected table ${table}`);
      });

      await toggleReviewLikeAction(reviewId, true, null);

      expect(mockRevalidatePath).not.toHaveBeenCalledWith(
        expect.stringContaining("/games/"),
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/reviews/${reviewId}`);
    });
  });

  describe("comment actions", () => {
    it("createReviewCommentAction inserts and revalidates the review page", async () => {
      mockInsert.mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });

      const result = await createReviewCommentAction(
        initialActionState,
        formData({ reviewId, body: "Nice review!" }),
      );

      expect(result.status).toBe("success");
      expect(mockInsert).toHaveBeenCalledWith({
        review_id: reviewId,
        body: "Nice review!",
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/reviews/${reviewId}`);
    });

    it("updateReviewCommentAction scopes to the authenticated user's own comment", async () => {
      const chain = makeChain({ error: null });
      mockUpdate.mockReturnValue(chain);
      mockFrom.mockReturnValue({ update: mockUpdate });

      await updateReviewCommentAction(
        initialActionState,
        formData({ commentId, reviewId, body: "Edited." }),
      );

      expect(chain.eq).toHaveBeenCalledWith("id", commentId);
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    });

    it("deleteReviewCommentAction scopes to the authenticated user's own comment", async () => {
      const chain = makeChain({ error: null });
      mockDelete.mockReturnValue(chain);
      mockFrom.mockReturnValue({ delete: mockDelete });

      const result = await deleteReviewCommentAction(
        initialActionState,
        formData({ commentId, reviewId }),
      );

      expect(chain.eq).toHaveBeenCalledWith("id", commentId);
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(result.status).toBe("success");
    });
  });
});
