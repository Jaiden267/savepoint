import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialActionState } from "@/lib/action-state";

const {
  mockGetUser,
  mockList,
  mockRemove,
  mockStorageFrom,
  mockEq,
  mockUpdate,
  mockFrom,
  mockRevalidatePath,
  mockRedirect,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockList = vi.fn();
  const mockRemove = vi.fn();
  const mockStorageFrom = vi.fn(() => ({
    list: mockList,
    remove: mockRemove,
  }));
  const mockEq = vi.fn();
  const mockUpdate = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ update: mockUpdate }));
  const mockRevalidatePath = vi.fn();
  const mockRedirect = vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
  return {
    mockGetUser,
    mockList,
    mockRemove,
    mockStorageFrom,
    mockEq,
    mockUpdate,
    mockFrom,
    mockRevalidatePath,
    mockRedirect,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      storage: { from: mockStorageFrom },
      from: mockFrom,
    }),
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import { removeAvatarAction } from "./profile";

/**
 * Covers the two effects required of a successful removal (storage cleanup +
 * avatar_path cleared), plus the failure paths that must surface to the UI
 * rather than leave storage and the database inconsistent with each other.
 * The nested-<form> UI bug that made "Remove" appear to do nothing is
 * covered separately in avatar-uploader.test.tsx.
 */
describe("removeAvatarAction", () => {
  const user = { id: "user-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user } });
    mockList.mockResolvedValue({
      data: [{ name: "avatar.png" }],
      error: null,
    });
    mockRemove.mockResolvedValue({ error: null });
    mockEq.mockResolvedValue({ error: null });
  });

  it("redirects unauthenticated callers instead of touching storage or the database", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(
      removeAvatarAction(initialActionState, new FormData()),
    ).rejects.toThrow("REDIRECT:/login");

    expect(mockStorageFrom).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("removes only the authenticated user's own storage objects", async () => {
    await removeAvatarAction(initialActionState, new FormData());

    expect(mockList).toHaveBeenCalledWith("user-1");
    expect(mockRemove).toHaveBeenCalledWith(["user-1/avatar.png"]);
  });

  it("does not call remove when the user has no existing avatar object", async () => {
    mockList.mockResolvedValue({ data: [], error: null });

    await removeAvatarAction(initialActionState, new FormData());

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("clears avatar_path for the authenticated user", async () => {
    await removeAvatarAction(initialActionState, new FormData());

    expect(mockUpdate).toHaveBeenCalledWith({ avatar_path: null });
    expect(mockEq).toHaveBeenCalledWith("id", "user-1");
  });

  it("surfaces a storage list failure to the UI and leaves avatar_path untouched", async () => {
    mockList.mockResolvedValue({
      data: null,
      error: { message: "list failed" },
    });

    const result = await removeAvatarAction(initialActionState, new FormData());

    expect(result.status).toBe("error");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("surfaces a storage remove failure to the UI and leaves avatar_path untouched", async () => {
    mockRemove.mockResolvedValue({ error: { message: "remove failed" } });

    const result = await removeAvatarAction(initialActionState, new FormData());

    expect(result.status).toBe("error");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("surfaces a database update failure to the UI", async () => {
    mockEq.mockResolvedValue({ error: { message: "db failed" } });

    const result = await removeAvatarAction(initialActionState, new FormData());

    expect(result.status).toBe("error");
  });

  it("revalidates the settings page and reports success", async () => {
    const result = await removeAvatarAction(initialActionState, new FormData());

    expect(result).toEqual({ status: "success", message: "Avatar removed." });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/profile");
  });
});
