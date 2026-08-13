/**
 * Guards against open-redirect via a client-controlled `next`/`redirect`
 * query param (e.g. an attacker-crafted `/login?next=https://evil.com`
 * link). Only a same-origin, root-relative path is ever considered safe —
 * anything else (absolute URLs, protocol-relative "//evil.com", an embedded
 * scheme, or a backslash-based variant some browsers/proxies normalize
 * toward "//evil.com", e.g. "/\evil.com") is rejected in favor of a
 * caller-supplied fallback.
 */
export function isSafeRedirectPath(
  path: string | null | undefined,
): path is string {
  if (!path) return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  if (path.includes("\\")) return false;
  return true;
}

export function safeRedirectPath(
  path: string | null | undefined,
  fallback: string,
): string {
  return isSafeRedirectPath(path) ? path : fallback;
}
