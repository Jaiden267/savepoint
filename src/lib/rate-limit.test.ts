import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, _resetRateLimitsForTests } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it("allows requests up to the limit", () => {
    const key = "user-a";
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, { limit: 3, windowSeconds: 60 }).allowed).toBe(
        true,
      );
    }
  });

  it("blocks once the limit is exceeded within the window", () => {
    const key = "user-b";
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, { limit: 3, windowSeconds: 60 });
    }
    const result = checkRateLimit(key, { limit: 3, windowSeconds: 60 });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    checkRateLimit("user-c", { limit: 1, windowSeconds: 60 });
    const blocked = checkRateLimit("user-c", { limit: 1, windowSeconds: 60 });
    const otherKeyStillAllowed = checkRateLimit("user-d", {
      limit: 1,
      windowSeconds: 60,
    });
    expect(blocked.allowed).toBe(false);
    expect(otherKeyStillAllowed.allowed).toBe(true);
  });

  it("resets the window once it has fully elapsed", () => {
    const key = "user-e";
    checkRateLimit(key, { limit: 1, windowSeconds: -1 }); // already-expired window
    const result = checkRateLimit(key, { limit: 1, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
  });
});
