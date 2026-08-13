import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { isSafeRedirectPath } from "@/lib/auth/redirect-safety";

export const dynamic = "force-dynamic";

/**
 * PKCE code-exchange endpoint for every Supabase Auth email link (signup
 * confirmation, password recovery) — @supabase/ssr's current pattern for the
 * Next.js App Router. `emailRedirectTo`/`redirectTo` in the Server Actions
 * both point here with a `next` param telling us where to send the user
 * once the exchange succeeds.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Every redirect target below is built from NEXT_PUBLIC_APP_URL, never
  // from the incoming request's own origin/Host header — consistent with
  // every other emailRedirectTo/redirectTo in this codebase (see
  // docs/AUTH.md), and avoids trusting a client-controllable header for a
  // redirect target.
  const origin = clientEnv.NEXT_PUBLIC_APP_URL;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = isSafeRedirectPath(rawNext) ? rawNext : null;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      if (next) {
        return NextResponse.redirect(`${origin}${next}`);
      }

      // No explicit next — decide based on the user's profile.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username, onboarding_completed_at")
          .eq("id", user.id)
          .maybeSingle();

        if (profile && !profile.onboarding_completed_at) {
          return NextResponse.redirect(`${origin}/onboarding`);
        }
        if (profile) {
          return NextResponse.redirect(`${origin}/users/${profile.username}`);
        }
      }

      return NextResponse.redirect(`${origin}/`);
    }
  }

  // Missing/invalid code, or the exchange failed (expired or already-used
  // link): send the user somewhere they can recover, with a friendly,
  // non-technical explanation — never a raw Supabase error.
  return NextResponse.redirect(`${origin}/login?error=link_invalid`);
}
