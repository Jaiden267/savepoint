import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordClick } from "@/server/services/recommendations";
import { recommendationIgdbIdSchema } from "@/lib/validation/recommendations";

export const dynamic = "force-dynamic";

/** This payload is one small integer — reject anything larger before ever parsing it. */
const MAX_BODY_BYTES = 1024;

const CLICK_RATE_LIMIT = { limit: 120, windowSeconds: 60 * 60 };

/**
 * `navigator.sendBeacon`/`fetch(..., {keepalive:true})` target for cached
 * (`<Link>`-navigated) recommendation clicks — see the click-tracking
 * design in docs/RECOMMENDATIONS.md for why a beacon is needed here (a
 * same-page click-then-navigate can cancel a plain fire-and-forget
 * `fetch`, unlike a `<form>` submission, which is already a request the
 * browser waits on). Hardened as a real, narrow endpoint, not a bare
 * handler:
 *
 *  1. Auth required — cookies arrive automatically on a same-origin
 *     sendBeacon/fetch call.
 *  2. Cross-origin rejection via Origin/Sec-Fetch-Site — this endpoint's
 *     actual CSRF defense (cookie-authenticated, no separate CSRF token
 *     exists anywhere in this codebase; both headers are browser-set and
 *     not spoofable by page JS).
 *  3. Content-Type must be exactly application/json (the client
 *     constructs the beacon body as a Blob with that explicit type, not a
 *     bare string, which would default to text/plain).
 *  4. A small explicit body-size cap.
 *  5. Strict igdbId validation.
 *
 * A failure at any layer here still must never block navigation
 * client-side — the click handler's own try/catch swallows any non-2xx
 * response the same way it swallows a network error.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");
  const originAllowed =
    origin === null || origin === clientEnv.NEXT_PUBLIC_APP_URL;
  const secFetchSiteAllowed =
    secFetchSite === null || secFetchSite === "same-origin";
  if (!originAllowed || !secFetchSiteAllowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json(
      { error: "unsupported_media_type" },
      { status: 415 },
    );
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const igdbIdCandidate =
    parsedJson && typeof parsedJson === "object" && "igdbId" in parsedJson
      ? (parsedJson as { igdbId: unknown }).igdbId
      : undefined;
  const parsed = recommendationIgdbIdSchema.safeParse(igdbIdCandidate);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_igdb_id" }, { status: 400 });
  }

  const rate = checkRateLimit(
    `recommendation-feedback:${user.id}`,
    CLICK_RATE_LIMIT,
  );
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    await recordClick(supabase, user.id, parsed.data);
  } catch {
    // Best-effort telemetry — a write failure still returns 200 so the
    // client never treats it as something worth retrying/surfacing.
  }

  return NextResponse.json({ ok: true });
}
