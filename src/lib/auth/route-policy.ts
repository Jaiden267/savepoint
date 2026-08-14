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
  "/home",
  "/lists/new",
  "/recommendations",
]);

/** Subset of REQUIRES_AUTH_PATHS that additionally require onboarding to be done. */
const REQUIRES_COMPLETED_PROFILE_PATHS = new Set([
  "/settings/profile",
  "/library",
  "/diary",
  "/home",
  "/lists/new",
  "/recommendations",
]);

/**
 * Matches exactly `/lists/<one segment>/edit` — e.g. `/lists/abc123/edit` —
 * and nothing deeper or shallower (`/lists/abc/edit/x`,
 * `/lists/abc/x/edit`, bare `/lists/abc` all fail to match). `/lists/[id]`
 * is a dynamic route, so it can't be listed in the exact-match Sets above;
 * this is the "switch to prefix matching" this file's own comment
 * anticipated once a nested protected route showed up.
 */
const LIST_EDIT_PATTERN = /^\/lists\/[^/]+\/edit$/;

function isListEditPath(pathname: string): boolean {
  return LIST_EDIT_PATTERN.test(pathname);
}

/**
 * The single source of truth for "does this path need the extra
 * auth/profile decision logic at all" — covers both the exact-match Sets
 * above and the pattern-matched routes. `src/lib/supabase/session.ts` calls
 * this (never a raw `GATED_PATHS.has()`) so a path added here, whether
 * exact or pattern-matched, can never again silently fall out of sync with
 * what the proxy actually fetches a profile for — that exact class of drift
 * (a path gated in one file but not the other) is what caused `/diary` to
 * resolve with a stale `onboardingCompleted=false` and redirect through
 * `/onboarding` to the wrong destination — see route-policy.test.ts's
 * regression test.
 */
export function isGatedPath(pathname: string): boolean {
  return (
    AUTH_ONLY_PATHS.has(pathname) ||
    REQUIRES_AUTH_PATHS.has(pathname) ||
    isListEditPath(pathname)
  );
}

function profileDestination(username?: string | null): string {
  return username ? `/users/${username}` : "/";
}

export function resolveRoutePolicy(input: RoutePolicyInput): RoutePolicyResult {
  const { pathname, isAuthenticated, onboardingCompleted, username } = input;

  if (AUTH_ONLY_PATHS.has(pathname) && isAuthenticated) {
    return { action: "redirect", destination: profileDestination(username) };
  }

  const requiresAuth =
    REQUIRES_AUTH_PATHS.has(pathname) || isListEditPath(pathname);

  if (requiresAuth) {
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

    const requiresCompletedProfile =
      REQUIRES_COMPLETED_PROFILE_PATHS.has(pathname) ||
      isListEditPath(pathname);

    if (requiresCompletedProfile && !onboardingCompleted) {
      return { action: "redirect", destination: "/onboarding" };
    }
  }

  return { action: "allow" };
}
