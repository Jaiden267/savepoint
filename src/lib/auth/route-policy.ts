/**
 * Pure route-protection decision logic, deliberately factored out of
 * src/proxy.ts / src/lib/supabase/session.ts so it can be unit tested
 * without mocking NextRequest/Supabase at all — see route-policy.test.ts.
 * The proxy is a thin adapter: gather auth/profile state, call this, act on
 * the result.
 *
 * Exact-match path Sets are sufficient for this prompt's route set (no
 * nested protected routes yet). If a future prompt adds e.g.
 * /settings/profile/anything, switch to a prefix check.
 */

export type RoutePolicyResult =
  | { action: "allow" }
  | { action: "redirect"; destination: string; query?: Record<string, string> };

export interface RoutePolicyInput {
  pathname: string;
  isAuthenticated: boolean;
  onboardingCompleted: boolean;
  /** Username of the current user, if known — used to build their profile URL. */
  username?: string | null;
}

/** Redirect an already-authenticated user away from these — no reason to sign in twice. */
const AUTH_ONLY_PATHS = new Set(["/login", "/signup", "/forgot-password"]);

/** Require a session at all. */
const REQUIRES_AUTH_PATHS = new Set([
  "/onboarding",
  "/settings/profile",
  "/reset-password",
  "/library",
  "/diary",
]);

/** Subset of REQUIRES_AUTH_PATHS that additionally require onboarding to be done. */
const REQUIRES_COMPLETED_PROFILE_PATHS = new Set([
  "/settings/profile",
  "/library",
  "/diary",
]);

/**
 * Every path whose decision can depend on isAuthenticated/onboardingCompleted/
 * username — i.e. every path resolveRoutePolicy actually reads those fields
 * for. The single source of truth for which paths need the extra profile
 * lookup: src/lib/supabase/session.ts imports this instead of maintaining
 * its own separate list, specifically so a path added to REQUIRES_AUTH_PATHS
 * here can never again silently fall out of sync with what the proxy
 * actually fetches (that drift is exactly what caused /diary to resolve
 * with a stale onboardingCompleted=false and redirect through /onboarding
 * to the wrong destination — see route-policy.test.ts's regression test).
 */
export const GATED_PATHS = new Set([
  ...AUTH_ONLY_PATHS,
  ...REQUIRES_AUTH_PATHS,
]);

function profileDestination(username?: string | null): string {
  return username ? `/users/${username}` : "/";
}

export function resolveRoutePolicy(input: RoutePolicyInput): RoutePolicyResult {
  const { pathname, isAuthenticated, onboardingCompleted, username } = input;

  if (AUTH_ONLY_PATHS.has(pathname) && isAuthenticated) {
    return { action: "redirect", destination: profileDestination(username) };
  }

  if (REQUIRES_AUTH_PATHS.has(pathname)) {
    if (!isAuthenticated) {
      // /reset-password is reached via a recovery-link session, not a
      // normal sign-in — send an unauthenticated visitor to start the
      // recovery flow instead of a generic login page.
      if (pathname === "/reset-password") {
        return { action: "redirect", destination: "/forgot-password" };
      }
      return {
        action: "redirect",
        destination: "/login",
        query: { next: pathname },
      };
    }

    if (pathname === "/onboarding") {
      // Don't make a user who already finished onboarding redo it.
      return onboardingCompleted
        ? { action: "redirect", destination: profileDestination(username) }
        : { action: "allow" };
    }

    if (
      REQUIRES_COMPLETED_PROFILE_PATHS.has(pathname) &&
      !onboardingCompleted
    ) {
      return { action: "redirect", destination: "/onboarding" };
    }
  }

  return { action: "allow" };
}
