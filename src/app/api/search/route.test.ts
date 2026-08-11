import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

const { mockSearchGames, mockGetClientIdentifier } = vi.hoisted(() => ({
  mockSearchGames: vi.fn(),
  mockGetClientIdentifier: vi.fn(),
}));

vi.mock("@/server/services/game-catalogue", () => ({
  searchGames: mockSearchGames,
}));

vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));

import { GET } from "./route";

function makeRequest(query: string) {
  return new NextRequest(
    new URL(
      `/api/search?q=${encodeURIComponent(query)}`,
      "http://localhost:3000",
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockGetClientIdentifier.mockResolvedValue("client-1");
  mockSearchGames.mockResolvedValue([]);
});

/** This route is the only IGDB-touching endpoint exposed to the browser — it must only ever call the read/merge search service, never anything import-capable. */
describe("GET /api/search", () => {
  it("rejects a missing query without calling the service", async () => {
    const response = await GET(makeRequest(""));
    const body = (await response.json()) as { results: unknown[] };

    expect(body.results).toEqual([]);
    expect(mockSearchGames).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only query", async () => {
    const response = await GET(makeRequest("   "));
    const body = (await response.json()) as { results: unknown[] };

    expect(body.results).toEqual([]);
    expect(mockSearchGames).not.toHaveBeenCalled();
  });

  it("rejects an over-length query", async () => {
    const response = await GET(makeRequest("a".repeat(101)));
    const body = (await response.json()) as { results: unknown[] };

    expect(body.results).toEqual([]);
    expect(mockSearchGames).not.toHaveBeenCalled();
  });

  it("returns capped, capped-length results from the service for a valid query", async () => {
    mockSearchGames.mockResolvedValue([{ igdbId: 1, name: "Game" }]);

    const response = await GET(makeRequest("zelda"));
    const body = (await response.json()) as { results: unknown[] };

    expect(mockSearchGames).toHaveBeenCalledWith("zelda", { limit: 20 });
    expect(body.results).toEqual([{ igdbId: 1, name: "Game" }]);
  });

  it("returns 429 once the per-client rate limit is exhausted", async () => {
    for (let i = 0; i < 20; i += 1) {
      await GET(makeRequest("zelda"));
    }

    const response = await GET(makeRequest("zelda"));

    expect(response.status).toBe(429);
  });
});
