import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockExchangeCodeForSession, mockGetUser, mockMaybeSingle, mockFrom } =
  vi.hoisted(() => {
    const mockMaybeSingle = vi.fn();
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    return {
      mockExchangeCodeForSession: vi.fn(),
      mockGetUser: vi.fn(),
      mockMaybeSingle,
      mockFrom,
    };
  });

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
        getUser: mockGetUser,
      },
      from: mockFrom,
    }),
  ),
}));
vi.mock("@/lib/env", () => ({
  clientEnv: { NEXT_PUBLIC_APP_URL: "https://savepoint.example" },
}));

import { GET } from "./route";

function requestWithHost(pathAndQuery: string, host: string) {
  // A spoofed/attacker-controlled Host header must never influence the
  // redirect target — every branch below asserts the response always
  // starts with the mocked NEXT_PUBLIC_APP_URL, never `host`.
  return new NextRequest(`http://${host}${pathAndQuery}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /auth/callback", () => {
  it("redirects to the safe next param on a successful exchange", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      requestWithHost(
        "/auth/callback?code=abc&next=%2Fonboarding",
        "attacker.example",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://savepoint.example/onboarding",
    );
  });

  it("ignores an unsafe next param and falls back to profile-completeness logic", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { username: "alice", onboarding_completed_at: "2026-01-01" },
      error: null,
    });

    const response = await GET(
      requestWithHost(
        "/auth/callback?code=abc&next=https%3A%2F%2Fevil.example",
        "attacker.example",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://savepoint.example/users/alice",
    );
  });

  it("redirects to /onboarding when the profile hasn't completed onboarding", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { username: "alice", onboarding_completed_at: null },
      error: null,
    });

    const response = await GET(
      requestWithHost("/auth/callback?code=abc", "attacker.example"),
    );

    expect(response.headers.get("location")).toBe(
      "https://savepoint.example/onboarding",
    );
  });

  it("redirects to / when the exchange succeeds but no profile row exists", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await GET(
      requestWithHost("/auth/callback?code=abc", "attacker.example"),
    );

    expect(response.headers.get("location")).toBe("https://savepoint.example/");
  });

  it("redirects to /login?error=link_invalid when the code exchange fails (expired/used link)", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid flow state" },
    });

    const response = await GET(
      requestWithHost("/auth/callback?code=abc", "attacker.example"),
    );

    expect(response.headers.get("location")).toBe(
      "https://savepoint.example/login?error=link_invalid",
    );
  });

  it("redirects to /login?error=link_invalid when the code param is missing", async () => {
    const response = await GET(
      requestWithHost("/auth/callback", "attacker.example"),
    );

    expect(response.headers.get("location")).toBe(
      "https://savepoint.example/login?error=link_invalid",
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("never derives the redirect origin from the request's Host header, even a spoofed one", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      requestWithHost(
        "/auth/callback?code=abc&next=%2Fonboarding",
        "evil-attacker-controlled-host.example",
      ),
    );

    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("https://savepoint.example/")).toBe(true);
    expect(location).not.toContain("evil-attacker-controlled-host.example");
  });
});
