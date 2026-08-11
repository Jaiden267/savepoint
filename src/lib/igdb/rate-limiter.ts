import "server-only";

const REQUESTS_PER_SECOND = 4;
const MAX_CONCURRENT = 8;
const TICK_MS = Math.ceil(1000 / REQUESTS_PER_SECOND);

/**
 * Process-wide IGDB request scheduler: paces dispatch to at most 4/s (one
 * task released per TICK_MS) while also never letting more than 8 run
 * concurrently. Appropriate for a single Node.js instance only — this is an
 * in-memory queue, not a distributed limiter, matching src/lib/rate-limit.ts's
 * framing for the same reason, though the algorithm here is a different
 * shape (shared-global-rate + concurrency cap, not a per-key fixed window).
 */
class IgdbRateLimiter {
  private queue: Array<() => void> = [];
  private inFlight = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.inFlight += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.inFlight -= 1;
          });
      });
      this.ensureTicking();
    });
  }

  private ensureTicking() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    if (this.queue.length > 0 && this.inFlight < MAX_CONCURRENT) {
      const task = this.queue.shift();
      task?.();
    }
    if (this.queue.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test-only: resets all internal state (queue, in-flight count, timer). */
  reset() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
    this.inFlight = 0;
  }
}

export const igdbRateLimiter = new IgdbRateLimiter();

/** Test-only: resets the shared limiter so tests don't leak state into each other. */
export function _resetIgdbRateLimiterForTests() {
  igdbRateLimiter.reset();
}
