import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";
import { resolveRoutePolicy, isGatedPath } from "@/lib/auth/route-policy";
import type { Database } from "@/types/database";

// isGatedPath() is imported from route-policy.ts (the paths the route
// policy actually cares about, restricting the profile lookup to just those
// to keep the proxy's per-request overhead near-zero for the vast majority
// of public/ungated requests) rather than a duplicated list here — covers
// both exact-match and pattern-matched (e.g. /lists/[id]/edit) paths, so a
// path gated in route-policy.ts automatically reaches this check too.

/**
 * Refreshes the Supabase auth session cookie on every matched request, then
 * applies route protection (auth-required pages, onboarding gating,
 * redirecting already-authenticated users away from login/signup) via the
 * pure resolveRoutePolicy() decision function. Called from the proxy
 * interceptor (see src/proxy.ts).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() must be called to trigger the token refresh + cookie
  // write. Do not run other logic between client creation and this call.
  // getUser() (unlike reading the session cookie directly) revalidates the
  // token against Supabase Auth, so route decisions below never trust an
  // unverified cookie value.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  let username: string | null = null;
  let onboardingCompleted = false;
  if (user && isGatedPath(pathname)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle();
    username = profile?.username ?? null;
    onboardingCompleted = Boolean(profile?.onboarding_completed_at);
  }

  const policy = resolveRoutePolicy({
    pathname,
    isAuthenticated: Boolean(user),
    onboardingCompleted,
    username,
  });

  if (policy.action === "redirect") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = policy.destination;
    redirectUrl.search = "";
    if (policy.query) {
      for (const [key, value] of Object.entries(policy.query)) {
        redirectUrl.searchParams.set(key, value);
      }
    }
    return { response: NextResponse.redirect(redirectUrl), user };
  }

  return { response, user };
}
