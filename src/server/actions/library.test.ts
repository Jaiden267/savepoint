import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialActionState } from "@/lib/action-state";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
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
  setGameStatusAction,
  rateGameAction,
  clearRatingAction,
  removeFromLibraryAction,
} from "./library";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

describe("library actions", () => {
  const user = { id: "user-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user } });
  });

  describe("setGameStatusAction", () => {
    function makeUpdateChain(result: {
      data: unknown[] | null;
      error: unknown;
    }) {
      const chain = {
        eq: vi.fn(() => chain),
        select: vi.fn(() => chain),
      };
      Object.assign(chain, {
        then: (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      });
      return chain;
    }

    beforeEach(() => {
      mockFrom.mockReturnValue({ update: mockUpdate, insert: mockInsert });
    });

    it("redirects unauthenticated callers instead of touching the database", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await expect(
        setGameStatusAction(
          initialActionState,
          formData({ gameId, gameSlug, status: "playing" }),
        ),
      ).rejects.toThrow("REDIRECT:/login");

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("rejects an invalid status without touching the database", async () => {
      const result = await setGameStatusAction(
        initialActionState,
        formData({ gameId, gameSlug, status: "finished" }),
      );

      expect(result.status).toBe("error");
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("existing row: update finds it, succeeds, and insert is never called", async () => {
      mockUpdate.mockReturnValue(
        makeUpdateChain({ data: [{ id: "row-1" }], error: null }),
      );

      const result = await setGameStatusAction(
        initialActionState,
        formData({ gameId, gameSlug, status: "playing" }),
      );

      expect(result.status).toBe("success");
      expect(mockUpdate).toHaveBeenCalledWith({ status: "playing" });
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/games/${gameSlug}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/library");
    });

    it("no existing row: update finds nothing, falls back to insert, succeeds", async () => {
      mockUpdate.mockReturnValue(makeUpdateChain({ data: [], error: null }));
      mockInsert.mockResolvedValue({ error: null });

      const result = await setGameStatusAction(
        initialActionState,
        formData({ gameId, gameSlug, status: "playing" }),
      );

      expect(result.status).toBe("success");
      expect(mockInsert).toHaveBeenCalledWith({
        game_id: gameId,
        status: "playing",
      });
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it("insert races (23505): retries the update with the originally-requested status, succeeds when the retry finds the row", async () => {
      mockUpdate
        .mockReturnValueOnce(makeUpdateChain({ data: [], error: null }))
        .mockReturnValueOnce(
          makeUpdateChain({ data: [{ id: "row-1" }], error: null }),
        );
      mockInsert.mockResolvedValue({
        error: { code: "23505", message: "duplicate key value" },
      });

      const result = await setGameStatusAction(
        initialActionState,
        formData({ gameId, gameSlug, status: "completed" }),
      );

      expect(result.status).toBe("success");
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      // Both the initial and the retried update request the status this
      // call actually asked for — the concurrent request's write doesn't
      // silently win.
      expect(mockUpdate).toHaveBeenNthCalledWith(1, { status: "completed" });
      expect(mockUpdate).toHaveBeenNthCalledWith(2, { status: "completed" });
    });

    it("insert races (23505) but the retry finds no row: reports a friendly failure, not success", async () => {
      mockUpdate
        .mockReturnValueOnce(makeUpdateChain({ data: [], error: null }))
        .mockReturnValueOnce(makeUpdateChain({ data: [], error: null }));
      mockInsert.mockResolvedValue({
        error: { code: "23505", message: "duplicate key value" },
      });

      const result = await setGameStatusAction(
        initialActionState,
        formData({ gameId, gameSlug, status: "completed" }),
      );

      expect(result.status).toBe("error");
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it("never includes a rating key in any payload — update, insert, or the retry update", async () => {
      mockUpdate
        .mockReturnValueOnce(makeUpdateChain({ data: [], error: null }))
        .mockReturnValueOnce(
          makeUpdateChain({ data: [{ id: "row-1" }], error: null }),
        );
      mockInsert.mockResolvedValue({
        error: { code: "23505", message: "duplicate key value" },
      });

      await setGameStatusAction(
        initialActionState,
        formData({ gameId, gameSlug, status: "playing" }),
      );

      for (const call of mockUpdate.mock.calls) {
        expect("rating" in (call[0] as Record<string, unknown>)).toBe(false);
      }
      for (const call of mockInsert.mock.calls) {
        expect("rating" in (call[0] as Record<string, unknown>)).toBe(false);
      }
    });
  });

  describe("rateGameAction", () => {
    let chain: {
      eq: ReturnType<typeof vi.fn>;
      select: ReturnType<typeof vi.fn>;
      __setResult: (r: unknown) => void;
    };

    beforeEach(() => {
      let result: unknown = { data: [{ id: "row-1" }], error: null };
      chain = {
        eq: vi.fn(() => chain),
        select: vi.fn(() => chain),
        __setResult: (r: unknown) => {
          result = r;
        },
      };
      Object.assign(chain, {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      });
      chain.__setResult({ data: [{ id: "row-1" }], error: null });
      mockUpdate.mockReturnValue(chain);
      mockFrom.mockReturnValue({ update: mockUpdate });
    });

    it("redirects unauthenticated callers", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await expect(
        rateGameAction(
          initialActionState,
          formData({ gameId, gameSlug, stars: "3.5" }),
        ),
      ).rejects.toThrow("REDIRECT:/login");

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("rejects a missing rating without touching the database", async () => {
      const result = await rateGameAction(
        initialActionState,
        formData({ gameId, gameSlug, stars: "" }),
      );

      expect(result.status).toBe("error");
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("scopes the update to the authenticated user's own row", async () => {
      await rateGameAction(
        initialActionState,
        formData({ gameId, gameSlug, stars: "3.5" }),
      );

      expect(mockUpdate).toHaveBeenCalledWith({ rating: 7 });
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(chain.eq).toHaveBeenCalledWith("game_id", gameId);
    });

    it("returns a friendly error when no user_games row exists yet (empty result)", async () => {
      chain.__setResult({ data: [], error: null });

      const result = await rateGameAction(
        initialActionState,
        formData({ gameId, gameSlug, stars: "3.5" }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toMatch(/add this game to your library/i);
    });

    it("succeeds and revalidates when a row was updated", async () => {
      const result = await rateGameAction(
        initialActionState,
        formData({ gameId, gameSlug, stars: "3.5" }),
      );

      expect(result.status).toBe("success");
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/games/${gameSlug}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/library");
    });
  });

  describe("clearRatingAction", () => {
    let chain: { eq: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      const result = { error: null };
      chain = { eq: vi.fn(() => chain) };
      Object.assign(chain, {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      });
      mockUpdate.mockReturnValue(chain);
      mockFrom.mockReturnValue({ update: mockUpdate });
    });

    it("sets rating to null, scoped to the authenticated user", async () => {
      const result = await clearRatingAction(
        initialActionState,
        formData({ gameId, gameSlug }),
      );

      expect(mockUpdate).toHaveBeenCalledWith({ rating: null });
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(chain.eq).toHaveBeenCalledWith("game_id", gameId);
      expect(result.status).toBe("success");
    });
  });

  describe("removeFromLibraryAction", () => {
    let chain: { eq: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      const result = { error: null };
      chain = { eq: vi.fn(() => chain) };
      Object.assign(chain, {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      });
      mockDelete.mockReturnValue(chain);
      mockFrom.mockReturnValue({ delete: mockDelete });
    });

    it("deletes only the authenticated user's own row", async () => {
      const result = await removeFromLibraryAction(
        initialActionState,
        formData({ gameId, gameSlug }),
      );

      expect(mockDelete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(chain.eq).toHaveBeenCalledWith("game_id", gameId);
      expect(result.status).toBe("success");
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/games/${gameSlug}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/library");
    });
  });
});
