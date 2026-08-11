import { describe, it, expect } from "vitest";
import { resolveRoutePolicy, GATED_PATHS } from "./route-policy";

describe("resolveRoutePolicy", () => {
  describe("unauthenticated", () => {
    it("allows public auth pages", () => {
      for (const pathname of ["/login", "/signup", "/forgot-password"]) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: false,
            onboardingCompleted: false,
          }),
        ).toEqual({ action: "allow" });
      }
    });

    it("redirects protected pages to /login with a next param", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/settings/profile",
          isAuthenticated: false,
          onboardingCompleted: false,
        }),
      ).toEqual({
        action: "redirect",
        destination: "/login",
        query: { next: "/settings/profile" },
      });

      expect(
        resolveRoutePolicy({
          pathname: "/onboarding",
          isAuthenticated: false,
          onboardingCompleted: false,
        }),
      ).toEqual({
        action: "redirect",
        destination: "/login",
        query: { next: "/onboarding" },
      });
    });

    it("redirects /reset-password to /forgot-password instead of /login", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/reset-password",
          isAuthenticated: false,
          onboardingCompleted: false,
        }),
      ).toEqual({ action: "redirect", destination: "/forgot-password" });
    });

    it("allows unrelated public pages", () => {
      for (const pathname of ["/", "/users/someone", "/api/health"]) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: false,
            onboardingCompleted: false,
          }),
        ).toEqual({ action: "allow" });
      }
    });
  });

  describe("authenticated, onboarding incomplete", () => {
    it("redirects away from login/signup/forgot-password to the profile", () => {
      for (const pathname of ["/login", "/signup", "/forgot-password"]) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: true,
            onboardingCompleted: false,
            username: "alice",
          }),
        ).toEqual({ action: "redirect", destination: "/users/alice" });
      }
    });

    it("falls back to / when username is unknown", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/login",
          isAuthenticated: true,
          onboardingCompleted: false,
          username: null,
        }),
      ).toEqual({ action: "redirect", destination: "/" });
    });

    it("allows /onboarding itself", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/onboarding",
          isAuthenticated: true,
          onboardingCompleted: false,
        }),
      ).toEqual({ action: "allow" });
    });

    it("redirects /settings/profile to /onboarding", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/settings/profile",
          isAuthenticated: true,
          onboardingCompleted: false,
        }),
      ).toEqual({ action: "redirect", destination: "/onboarding" });
    });

    it("allows /reset-password (orthogonal to onboarding)", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/reset-password",
          isAuthenticated: true,
          onboardingCompleted: false,
        }),
      ).toEqual({ action: "allow" });
    });
  });

  describe("authenticated, onboarding complete", () => {
    it("redirects /onboarding to the profile", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/onboarding",
          isAuthenticated: true,
          onboardingCompleted: true,
          username: "alice",
        }),
      ).toEqual({ action: "redirect", destination: "/users/alice" });
    });

    it("allows /settings/profile", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/settings/profile",
          isAuthenticated: true,
          onboardingCompleted: true,
          username: "alice",
        }),
      ).toEqual({ action: "allow" });
    });

    it("still redirects away from login/signup/forgot-password", () => {
      expect(
        resolveRoutePolicy({
          pathname: "/signup",
          isAuthenticated: true,
          onboardingCompleted: true,
          username: "alice",
        }),
      ).toEqual({ action: "redirect", destination: "/users/alice" });
    });
  });

  describe("GATED_PATHS — the single source of truth session.ts relies on", () => {
    it("includes every path a redirect decision can depend on isAuthenticated/onboardingCompleted/username for", () => {
      for (const pathname of [
        "/login",
        "/signup",
        "/forgot-password",
        "/onboarding",
        "/settings/profile",
        "/reset-password",
        "/library",
        "/diary",
      ]) {
        expect(GATED_PATHS.has(pathname)).toBe(true);
      }
    });
  });

  describe("/library and /diary — auth + completed profile required", () => {
    it("redirects unauthenticated visitors to /login with a next param", () => {
      for (const pathname of ["/library", "/diary"]) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: false,
            onboardingCompleted: false,
          }),
        ).toEqual({
          action: "redirect",
          destination: "/login",
          query: { next: pathname },
        });
      }
    });

    it("redirects authenticated-but-incomplete-profile visitors to /onboarding", () => {
      for (const pathname of ["/library", "/diary"]) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: true,
            onboardingCompleted: false,
          }),
        ).toEqual({ action: "redirect", destination: "/onboarding" });
      }
    });

    it("allows authenticated visitors with a completed profile", () => {
      for (const pathname of ["/library", "/diary"]) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: true,
            onboardingCompleted: true,
            username: "alice",
          }),
        ).toEqual({ action: "allow" });
      }
    });
  });

  describe("game discovery/search — public, no auth required", () => {
    const gamePaths = [
      "/discover",
      "/search",
      "/games/some-game-slug",
      "/reviews/4dd1ceb8-3446-4167-a4b7-174a8e9e0a58",
    ];

    it("allows unauthenticated visitors", () => {
      for (const pathname of gamePaths) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: false,
            onboardingCompleted: false,
          }),
        ).toEqual({ action: "allow" });
      }
    });

    it("allows authenticated visitors regardless of onboarding status", () => {
      for (const pathname of gamePaths) {
        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: true,
            onboardingCompleted: false,
            username: null,
          }),
        ).toEqual({ action: "allow" });

        expect(
          resolveRoutePolicy({
            pathname,
            isAuthenticated: true,
            onboardingCompleted: true,
            username: "alice",
          }),
        ).toEqual({ action: "allow" });
      }
    });
  });
});
