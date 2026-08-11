import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { igdbRateLimiter, _resetIgdbRateLimiterForTests } from "./rate-limiter";

beforeEach(() => {
  vi.useFakeTimers();
  _resetIgdbRateLimiterForTests();
});

afterEach(() => {
  _resetIgdbRateLimiterForTests();
  vi.useRealTimers();
});

describe("igdbRateLimiter", () => {
  it("dispatches at most one task per 250ms tick (4/s)", async () => {
    const order: number[] = [];
    const tasks = [0, 1, 2, 3, 4].map((i) =>
      igdbRateLimiter.schedule(async () => {
        order.push(i);
        return i;
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([0]);

    await vi.advanceTimersByTimeAsync(250);
    expect(order).toEqual([0, 1]);

    await vi.advanceTimersByTimeAsync(250);
    expect(order).toEqual([0, 1, 2]);

    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual([0, 1, 2, 3, 4]);

    await Promise.all(tasks);
  });

  it("never runs more than 8 tasks concurrently", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const tasks = Array.from({ length: 12 }, () =>
      igdbRateLimiter.schedule(async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        concurrent -= 1;
      }),
    );

    // Enough ticks (250ms each) to dispatch all 12 if concurrency didn't
    // gate them — but none of the long-running tasks have finished yet at
    // this point, so the concurrency cap must have held.
    await vi.advanceTimersByTimeAsync(3000);
    expect(maxConcurrent).toBeLessThanOrEqual(8);

    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(tasks);
  });

  it("resets internal state for test isolation", () => {
    void igdbRateLimiter.schedule(() => Promise.resolve());
    expect(() => _resetIgdbRateLimiterForTests()).not.toThrow();
  });
});
