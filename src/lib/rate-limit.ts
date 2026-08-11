import "server-only";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Drops already-expired buckets so long-lived process memory doesn't grow
 * unbounded. Runs lazily on access (only when the map has gotten large)
 * rather than on a timer — cheap and sufficient for a single-instance app.
 */
function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Simple in-memory fixed-window rate limiter. Deliberately appropriate for a
 * single-instance deployment only — state is process-local and resets on
 * restart or redeploy. This is a spam/abuse speed bump for auth submissions
 * and username-availability checks, not a hardened distributed rate limiter;
 * if Savepoint ever runs as more than one instance, replace this with a
 * shared store (e.g. Redis).
 */
export function checkRateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 5000) sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      ),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test-only: clears all buckets so tests don't leak state into each other. */
export function _resetRateLimitsForTests() {
  buckets.clear();
}
