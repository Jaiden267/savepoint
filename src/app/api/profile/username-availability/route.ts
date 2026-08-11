import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usernameSchema } from "@/lib/validation/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIdentifier } from "@/lib/auth/request-ip";

export const dynamic = "force-dynamic";

/**
 * Read-only, debounce-friendly username availability check for the
 * onboarding/settings forms. citext equality is inherently case-insensitive
 * — no ILIKE needed.
 */
export async function GET(request: NextRequest) {
  const identifier = await getClientIdentifier();
  const rate = checkRateLimit(`username-check:${identifier}`, {
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { available: false, reason: "rate_limited" },
      { status: 429 },
    );
  }

  const raw = request.nextUrl.searchParams.get("username") ?? "";
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ available: false, reason: "invalid" });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", parsed.data)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { available: false, reason: "error" },
      { status: 500 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A user re-submitting their own current username shouldn't see it as taken.
  const takenByOther = Boolean(data) && data?.id !== user?.id;
  return NextResponse.json({ available: !takenByOther });
}
