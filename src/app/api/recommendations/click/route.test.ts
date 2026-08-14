import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

const { mockGetUser, mockRecordClick } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockRecordClick: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { getUser: mockGetUser } }),
  ),
}));
vi.mock("@/lib/env", () => ({
  clientEnv: { NEXT_PUBLIC_APP_URL: "https://savepoint.example" },
}));
vi.mock("@/server/services/recommendations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/services/recommendations")>();
  return { ...actual, recordClick: mockRecordClick };
});

import { POST } from "./route";

const user = { id: "user-1" };

function makeRequest(options: {
  body?: string;
  contentType?: string | null;
  origin?: string | null;
  secFetchSite?: string | null;
}) {
  const headers = new Headers();
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "https://savepoint.example");
  }
  if (options.secFetchSite !== null) {
    headers.set("sec-fetch-site", options.secFetchSite ?? "same-origin");
  }
  return new NextRequest(
    "https://savepoint.example/api/recommendations/click",
    {
      method: "POST",
      headers,
      body: options.body ?? JSON.stringify({ igdbId: 123 }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockGetUser.mockResolvedValue({ data: { user } });
  mockRecordClick.mockResolvedValue(undefined);
});

describe("POST /api/recommendations/click", () => {
  it("401s a request with no authenticated session, before any other check", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(makeRequest({}));

    expect(response.status).toBe(401);
    expect(mockRecordClick).not.toHaveBeenCalled();
  });

  it("403s a cross-origin request (mismatched Origin header)", async () => {
    const response = await POST(
      makeRequest({ origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(mockRecordClick).not.toHaveBeenCalled();
  });

  it("403s a request whose Sec-Fetch-Site isn't same-origin", async () => {
    const response = await POST(makeRequest({ secFetchSite: "cross-site" }));
    expect(response.status).toBe(403);
    expect(mockRecordClick).not.toHaveBeenCalled();
  });

  it("allows a request with no Origin/Sec-Fetch-Site headers at all (some legitimate same-origin beacons omit them)", async () => {
    const response = await POST(
      makeRequest({ origin: null, secFetchSite: null }),
    );
    expect(response.status).toBe(200);
  });

  it("415s a request with the wrong Content-Type (e.g. the sendBeacon text/plain default)", async () => {
    const response = await POST(makeRequest({ contentType: "text/plain" }));
    expect(response.status).toBe(415);
    expect(mockRecordClick).not.toHaveBeenCalled();
  });

  it("413s an oversized body before ever parsing it", async () => {
    const response = await POST(
      makeRequest({
        body: JSON.stringify({ igdbId: 1, junk: "x".repeat(2000) }),
      }),
    );
    expect(response.status).toBe(413);
    expect(mockRecordClick).not.toHaveBeenCalled();
  });

  it("400s an invalid/non-positive igdbId", async () => {
    const response = await POST(
      makeRequest({ body: JSON.stringify({ igdbId: -5 }) }),
    );
    expect(response.status).toBe(400);
    expect(mockRecordClick).not.toHaveBeenCalled();
  });

  it("400s a malformed JSON body", async () => {
    const response = await POST(makeRequest({ body: "not json" }));
    expect(response.status).toBe(400);
  });

  it("calls recordClick with the authenticated session's real userId — never a client-supplied one — once every check passes", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(200);
    expect(mockRecordClick).toHaveBeenCalledTimes(1);
    expect(mockRecordClick).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      123,
    );
  });

  it("still returns 200 (never blocks the caller) when recordClick itself fails", async () => {
    mockRecordClick.mockRejectedValue(new Error("db down"));
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(200);
  });

  it("429s once the shared recommendation-feedback rate-limit bucket is exhausted", async () => {
    for (let i = 0; i < 120; i++) {
      await POST(makeRequest({}));
    }
    mockRecordClick.mockClear();

    const response = await POST(makeRequest({}));

    expect(response.status).toBe(429);
    expect(mockRecordClick).not.toHaveBeenCalled();
  });
});
