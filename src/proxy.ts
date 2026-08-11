import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

/**
 * Next.js proxy (formerly "middleware"). Runs on matched requests to keep the
 * Supabase auth session fresh and apply route protection (auth-required
 * pages, onboarding gating, redirecting signed-in users away from
 * login/signup) — see src/lib/supabase/session.ts and
 * src/lib/auth/route-policy.ts.
 */
export async function proxy(request: NextRequest) {
  const { response } = await updateSession(request);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image files:
     * - _next/static, _next/image
     * - favicon.ico
     * - common image extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
