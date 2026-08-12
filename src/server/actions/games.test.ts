import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetClientIdentifier,
  mockCheckCatalogueImportRateLimit,
  mockImportGameByIgdbId,
  mockSyncGameVector,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetClientIdentifier: vi.fn(),
  mockCheckCatalogueImportRateLimit: vi.fn(),
  mockImportGameByIgdbId: vi.fn(),
  mockSyncGameVector: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));
vi.mock("@/server/services/game-sync", () => ({
  checkCatalogueImportRateLimit: mockCheckCatalogueImportRateLimit,
  importGameByIgdbId: mockImportGameByIgdbId,
}));
vi.mock("@/lib/pinecone/sync", () => ({
  syncGameVector: mockSyncGameVector,
}));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));
vi.mock("next/server", () => ({
  after: (fn: () => void) => fn(),
}));

import { importCatalogueGameAction } from "./games";
import { initialActionState } from "@/lib/action-state";

function formDataWithIgdbId(value: string) {
  const data = new FormData();
  data.set("igdbId", value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClientIdentifier.mockResolvedValue("client-1");
  mockCheckCatalogueImportRateLimit.mockReturnValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mockSyncGameVector.mockResolvedValue({ status: "synced" });
});

describe("importCatalogueGameAction", () => {
  it("rejects an invalid igdbId before any external call", async () => {
    const result = await importCatalogueGameAction(
      initialActionState,
      formDataWithIgdbId("not-a-number"),
    );

    expect(result.status).toBe("error");
    expect(mockGetClientIdentifier).not.toHaveBeenCalled();
    expect(mockImportGameByIgdbId).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("rejects a non-positive igdbId before any external call", async () => {
    const result = await importCatalogueGameAction(
      initialActionState,
      formDataWithIgdbId("-5"),
    );

    expect(result.status).toBe("error");
    expect(mockImportGameByIgdbId).not.toHaveBeenCalled();
  });

  it("returns a friendly error and never imports when the rate limit is exceeded", async () => {
    mockCheckCatalogueImportRateLimit.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 30,
    });

    const result = await importCatalogueGameAction(
      initialActionState,
      formDataWithIgdbId("42"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/too many/i);
    expect(mockImportGameByIgdbId).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("imports the game, fires the Pinecone sync, and redirects to the canonical game page on success", async () => {
    mockImportGameByIgdbId.mockResolvedValue({
      id: "game-uuid-1",
      slug: "the-game",
      igdb_id: 42,
    });

    await importCatalogueGameAction(
      initialActionState,
      formDataWithIgdbId("42"),
    );

    expect(mockImportGameByIgdbId).toHaveBeenCalledWith(42);
    expect(mockSyncGameVector).toHaveBeenCalledWith("game-uuid-1");
    expect(mockRedirect).toHaveBeenCalledWith("/games/the-game");
  });

  it("returns a friendly error and never redirects when the import throws", async () => {
    mockImportGameByIgdbId.mockRejectedValue(new Error("IGDB unavailable"));

    const result = await importCatalogueGameAction(
      initialActionState,
      formDataWithIgdbId("42"),
    );

    expect(result.status).toBe("error");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("keys the rate limit off the requesting client, not the igdbId", async () => {
    mockGetClientIdentifier.mockResolvedValue("client-specific");
    mockImportGameByIgdbId.mockResolvedValue({
      id: "game-uuid-2",
      slug: "other-game",
      igdb_id: 7,
    });

    await importCatalogueGameAction(
      initialActionState,
      formDataWithIgdbId("7"),
    );

    expect(mockCheckCatalogueImportRateLimit).toHaveBeenCalledWith(
      "client-specific",
    );
  });
});
