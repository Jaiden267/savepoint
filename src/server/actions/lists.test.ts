import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialActionState } from "@/lib/action-state";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

const LIST_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const ITEM_ID = "5ee2dfc9-4557-5278-b5c8-285b9f0f1b69";

const {
  mockGetUser,
  mockInsert,
  mockUpdate,
  mockDelete,
  mockFrom,
  mockRpc,
  mockRevalidatePath,
  mockRedirect,
  mockImportGameByIgdbId,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockImportGameByIgdbId: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/server/services/game-sync", () => ({
  importGameByIgdbId: mockImportGameByIgdbId,
}));

import {
  createListAction,
  updateListAction,
  deleteListAction,
  addListItemAction,
  removeListItemAction,
  reorderListItemsAction,
} from "./lists";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
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

describe("createListAction", () => {
  it("rejects an empty title without touching the database", async () => {
    const result = await createListAction(
      initialActionState,
      formData({ title: "", visibility: "public" }),
    );

    expect(result.status).toBe("error");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("redirects to the new list on success", async () => {
    const chain = makeChain({ data: { id: LIST_ID }, error: null });
    mockInsert.mockReturnValue(chain);
    mockFrom.mockReturnValue({ insert: mockInsert });

    await expect(
      createListAction(
        initialActionState,
        formData({ title: "My list", visibility: "public" }),
      ),
    ).rejects.toThrow(`REDIRECT:/lists/${LIST_ID}`);
  });
});

describe("updateListAction", () => {
  it("never includes userId in the update payload", async () => {
    const chain = makeChain({ error: null });
    mockUpdate.mockReturnValue(chain);
    mockFrom.mockReturnValue({ update: mockUpdate });

    await updateListAction(
      initialActionState,
      formData({
        listId: LIST_ID,
        title: "Renamed",
        visibility: "unlisted",
      }),
    );

    const [payload] = mockUpdate.mock.calls[0] as [Record<string, unknown>];
    expect("user_id" in payload).toBe(false);
  });

  it("scopes the update to the authenticated user's own row", async () => {
    const chain = makeChain({ error: null });
    mockUpdate.mockReturnValue(chain);
    mockFrom.mockReturnValue({ update: mockUpdate });

    await updateListAction(
      initialActionState,
      formData({ listId: LIST_ID, title: "Renamed", visibility: "public" }),
    );

    expect(chain.eq).toHaveBeenCalledWith("id", LIST_ID);
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("deleteListAction", () => {
  it("redirects to the owner's Lists tab after deleting", async () => {
    const chain = makeChain({ data: [{ id: LIST_ID }], error: null });
    mockDelete.mockReturnValue(chain);
    mockFrom.mockReturnValue({ delete: mockDelete });

    await expect(
      deleteListAction(
        initialActionState,
        formData({ listId: LIST_ID, ownerUsername: "alice" }),
      ),
    ).rejects.toThrow("REDIRECT:/users/alice/lists");
  });

  it("returns a friendly failure and never redirects when the delete affects zero rows (not the owner)", async () => {
    const chain = makeChain({ data: [], error: null });
    mockDelete.mockReturnValue(chain);
    mockFrom.mockReturnValue({ delete: mockDelete });

    const result = await deleteListAction(
      initialActionState,
      formData({ listId: LIST_ID, ownerUsername: "alice" }),
    );

    expect(result.status).toBe("error");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("addListItemAction", () => {
  it("imports the game via IGDB id, then inserts at max position + 1", async () => {
    mockImportGameByIgdbId.mockResolvedValue({
      id: "game-1",
      slug: "some-game",
      name: "Some Game",
      cover_image_id: null,
      release_date: null,
    });

    const maxPositionChain = makeChain({ data: { position: 3 } });
    const insertChain = makeChain({
      data: { id: "item-1", position: 4, note: null },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "list_items") {
        return { select: () => maxPositionChain, insert: mockInsert };
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockInsert.mockReturnValue(insertChain);

    const result = await addListItemAction(LIST_ID, 7346);

    expect(mockImportGameByIgdbId).toHaveBeenCalledWith(7346);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ game_id: "game-1", position: 4 }),
    );
    expect(result.status).toBe("success");
    expect(result.item?.position).toBe(4);
  });

  it("maps a 23505 on the list_game unique constraint to a friendly duplicate message", async () => {
    mockImportGameByIgdbId.mockResolvedValue({
      id: "game-1",
      slug: "some-game",
      name: "Some Game",
      cover_image_id: null,
      release_date: null,
    });

    const maxPositionChain = makeChain({ data: null });
    const insertChain = makeChain({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "list_items_list_game_key"',
      },
    });

    mockFrom.mockImplementation(() => ({
      select: () => maxPositionChain,
      insert: () => insertChain,
    }));

    const result = await addListItemAction(LIST_ID, 7346);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/already on the list/i);
  });

  it("returns a sign-in error for an unauthenticated caller, without redirecting", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await addListItemAction(LIST_ID, 7346);

    expect(result.status).toBe("error");
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockImportGameByIgdbId).not.toHaveBeenCalled();
  });

  it("rejects an invalid igdbId before any database call", async () => {
    const result = await addListItemAction(LIST_ID, -1);

    expect(result.status).toBe("error");
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockImportGameByIgdbId).not.toHaveBeenCalled();
  });
});

describe("removeListItemAction", () => {
  it("scopes the delete to the list, relying on RLS for ownership (no user_id column on list_items)", async () => {
    const chain = makeChain({ error: null });
    mockDelete.mockReturnValue(chain);
    mockFrom.mockReturnValue({ delete: mockDelete });

    await removeListItemAction(
      initialActionState,
      formData({ listId: LIST_ID, itemId: ITEM_ID }),
    );

    expect(chain.eq).toHaveBeenCalledWith("id", ITEM_ID);
    expect(chain.eq).toHaveBeenCalledWith("list_id", LIST_ID);
  });
});

describe("reorderListItemsAction", () => {
  it("rejects an empty item array before calling the RPC", async () => {
    const result = await reorderListItemsAction(LIST_ID, []);

    expect(result.status).toBe("error");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls the reorder_list_items RPC with the submitted order, in a single atomic call", async () => {
    mockRpc.mockResolvedValue({ error: null });

    const orderedIds = [ITEM_ID, "6ff3e0da-5668-4389-8c6d-9396c0a1c2c7"];
    const result = await reorderListItemsAction(LIST_ID, orderedIds);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("reorder_list_items", {
      p_list_id: LIST_ID,
      p_item_ids: orderedIds,
    });
    expect(result.status).toBe("success");
  });

  it("returns a friendly error and never claims success when the RPC fails (e.g. ownership/set-mismatch rejected server-side)", async () => {
    mockRpc.mockResolvedValue({
      error: { code: "22023", message: "item set mismatch" },
    });

    const result = await reorderListItemsAction(LIST_ID, [ITEM_ID]);

    expect(result.status).toBe("error");
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("returns a sign-in error for an unauthenticated caller, without calling the RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await reorderListItemsAction(LIST_ID, [ITEM_ID]);

    expect(result.status).toBe("error");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
