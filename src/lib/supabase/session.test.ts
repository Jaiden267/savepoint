import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "./session";

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

function makeRequest(pathname: string) {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

/**
 * Exercises the real route-policy logic (src/lib/auth/route-policy.ts) glued
 * together with a mocked Supabase server client — the only real external
 * dependency here. route-policy.test.ts already covers the decision matrix
 * exhaustively as a pure function; these tests instead verify session.ts
 * wires that logic up correctly (calls the DB only when it should, turns a
 * "redirect" result into a real NextResponse.redirect with the right
 * location).
 */
describe("updateSession", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockMaybeSingle.mockReset();
    mockFrom.mockClear();
  });

  it("allows an unauthenticated visitor to reach /login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { response } = await updateSession(makeRequest("/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated visitor away from /settings/profile, preserving next", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { response } = await updateSession(makeRequest("/settings/profile"));
    const location = response.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fsettings%2Fprofile");
  });

  it("redirects an authenticated user away from /login to their profile", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { username: "alice", onboarding_completed_at: "2026-01-01" },
    });
    const { response } = await updateSession(makeRequest("/login"));
    expect(response.headers.get("location")).toContain("/users/alice");
  });

  it("redirects an authenticated, onboarding-incomplete user away from /settings/profile", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { username: "alice", onboarding_completed_at: null },
    });
    const { response } = await updateSession(makeRequest("/settings/profile"));
    expect(response.headers.get("location")).toContain("/onboarding");
  });

  it("allows an authenticated, onboarding-complete user to reach /settings/profile", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { username: "alice", onboarding_completed_at: "2026-01-01" },
    });
    const { response } = await updateSession(makeRequest("/settings/profile"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("never queries the database for an ungated public path", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    await updateSession(makeRequest("/"));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("never queries the database for a gated path when there is no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await updateSession(makeRequest("/settings/profile"));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // Regression: /library and /diary were added to route-policy.ts's
  // REQUIRES_AUTH_PATHS/REQUIRES_COMPLETED_PROFILE_PATHS in isolation,
  // without also adding them to this file's own separately-maintained
  // GATED_PATHS set — so the profile lookup below never ran for /diary,
  // onboardingCompleted silently defaulted to false, and an already-
  // onboarded user got redirected to /onboarding, which (now gated, and
  // now with a real profile lookup) redirected them a second time to their
  // public profile — a two-hop redirect chain a visitor would only ever
  // observe as "/diary sends me to /users/[username]". GATED_PATHS is now
  // imported from route-policy.ts as the single source of truth so this
  // can't drift out of sync again.
  describe("/diary and /library — regression: must be gated the same way as /settings/profile", () => {
    it("redirects an unauthenticated visitor away from /diary, preserving next", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { response } = await updateSession(makeRequest("/diary"));
      const location = response.headers.get("location");
      expect(location).toContain("/login");
      expect(location).toContain("next=%2Fdiary");
    });

    it("queries the profile and allows an authenticated, onboarding-complete user through to /diary — no redirect anywhere, including not through /onboarding", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockMaybeSingle.mockResolvedValue({
        data: { username: "jd1453", onboarding_completed_at: "2026-01-01" },
      });

      const { response } = await updateSession(makeRequest("/diary"));

      expect(mockFrom).toHaveBeenCalledWith("profiles");
      expect(response.headers.get("location")).toBeNull();
    });

    it("redirects an authenticated, onboarding-incomplete user from /diary to /onboarding (not to their public profile)", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockMaybeSingle.mockResolvedValue({
        data: { username: "jd1453", onboarding_completed_at: null },
      });

      const { response } = await updateSession(makeRequest("/diary"));

      expect(response.headers.get("location")).toContain("/onboarding");
    });

    it("queries the profile and allows an authenticated, onboarding-complete user through to /library", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockMaybeSingle.mockResolvedValue({
        data: { username: "jd1453", onboarding_completed_at: "2026-01-01" },
      });

      const { response } = await updateSession(makeRequest("/library"));

      expect(mockFrom).toHaveBeenCalledWith("profiles");
      expect(response.headers.get("location")).toBeNull();
    });
  });
});
