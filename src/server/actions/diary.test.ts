import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialActionState } from "@/lib/action-state";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const entryId = "5ee2dfc9-4557-5278-b5c8-285b9f0f1b69";
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
  logDiaryEntryAction,
  updateDiaryEntryAction,
  deleteDiaryEntryAction,
} from "./diary";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain as { eq: ReturnType<typeof vi.fn> };
}

describe("diary actions", () => {
  const user = { id: "user-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user } });
  });

  describe("logDiaryEntryAction", () => {
    beforeEach(() => {
      mockInsert.mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });
    });

    it("redirects unauthenticated callers instead of touching the database", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await expect(
        logDiaryEntryAction(
          initialActionState,
          formData({
            gameId,
            gameSlug,
            playedOn: "2020-01-01",
            rating: "",
            note: "",
          }),
        ),
      ).rejects.toThrow("REDIRECT:/login");

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("rejects an invalid date without touching the database", async () => {
      const result = await logDiaryEntryAction(
        initialActionState,
        formData({
          gameId,
          gameSlug,
          playedOn: "not-a-date",
          rating: "",
          note: "",
        }),
      );

      expect(result.status).toBe("error");
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("never writes to user_games — rating here is an independent snapshot", async () => {
      await logDiaryEntryAction(
        initialActionState,
        formData({
          gameId,
          gameSlug,
          playedOn: "2020-01-01",
          rating: "4",
          note: "",
        }),
      );

      expect(mockFrom).toHaveBeenCalledWith("diary_entries");
      expect(mockFrom).not.toHaveBeenCalledWith("user_games");
    });

    it("converts the optional stars rating to a stored 1-10 value", async () => {
      await logDiaryEntryAction(
        initialActionState,
        formData({
          gameId,
          gameSlug,
          playedOn: "2020-01-01",
          rating: "4",
          note: "",
        }),
      );

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ rating: 8, game_id: gameId }),
      );
    });

    it("revalidates /diary and the game page on success", async () => {
      const result = await logDiaryEntryAction(
        initialActionState,
        formData({
          gameId,
          gameSlug,
          playedOn: "2020-01-01",
          rating: "",
          note: "",
        }),
      );

      expect(result.status).toBe("success");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/diary");
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/games/${gameSlug}`);
    });
  });

  describe("updateDiaryEntryAction", () => {
    let chain: { eq: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      chain = makeChain({ error: null });
      mockUpdate.mockReturnValue(chain);
      mockFrom.mockReturnValue({ update: mockUpdate });
    });

    it("never includes a gameId/game_id field in the update payload", async () => {
      await updateDiaryEntryAction(
        initialActionState,
        formData({
          entryId,
          gameSlug,
          playedOn: "2020-01-01",
          rating: "",
          note: "",
        }),
      );

      const [payload] = mockUpdate.mock.calls[0] as [Record<string, unknown>];
      expect("game_id" in payload).toBe(false);
    });

    it("never touches user_games", async () => {
      await updateDiaryEntryAction(
        initialActionState,
        formData({
          entryId,
          gameSlug,
          playedOn: "2020-01-01",
          rating: "",
          note: "",
        }),
      );

      expect(mockFrom).not.toHaveBeenCalledWith("user_games");
    });

    it("scopes the update to the authenticated user's own row", async () => {
      await updateDiaryEntryAction(
        initialActionState,
        formData({
          entryId,
          gameSlug,
          playedOn: "2020-01-01",
          rating: "",
          note: "",
        }),
      );

      expect(chain.eq).toHaveBeenCalledWith("id", entryId);
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    });
  });

  describe("deleteDiaryEntryAction", () => {
    it("deletes only the authenticated user's own row and revalidates", async () => {
      const chain = makeChain({ error: null });
      mockDelete.mockReturnValue(chain);
      mockFrom.mockReturnValue({ delete: mockDelete });

      const result = await deleteDiaryEntryAction(
        initialActionState,
        formData({ entryId, gameSlug }),
      );

      expect(chain.eq).toHaveBeenCalledWith("id", entryId);
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(result.status).toBe("success");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/diary");
    });
  });
});
