import "server-only";
import { headers } from "next/headers";

/**
 * Best-effort client identifier for rate-limiting keys. Falls back to a
 * shared bucket when no proxy header is present (e.g. local dev without a
 * reverse proxy) — acceptable here since this is a spam/abuse speed bump for
 * a single-instance deployment, not a hard security boundary.
 */
export async function getClientIdentifier(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]!.trim();
  }
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}
