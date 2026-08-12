import { describe, it, expect, vi } from "vitest";
import { EmbedRatePacer } from "./embed-rate-pacer";

describe("EmbedRatePacer.estimateTokens", () => {
  it("applies the chars/4 heuristic with the 1.3x safety multiplier", () => {
    // 400 chars -> 100 raw tokens -> 130 with the 1.3x margin.
    expect(EmbedRatePacer.estimateTokens([400])).toBe(130);
  });

  it("sums multiple char counts before applying the margin", () => {
    expect(EmbedRatePacer.estimateTokens([400, 400])).toBe(260);
  });
});

describe("EmbedRatePacer.waitForCapacity", () => {
  it("sends immediately when the batch fits within the target", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const pacer = new EmbedRatePacer(1000, () => 0, sleep);

    await pacer.waitForCapacity(500);

    expect(sleep).not.toHaveBeenCalled();
  });

  it("delays (does not send immediately) a batch that would push the trailing window over the target", async () => {
    let now = 0;
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      now += ms;
    });
    const pacer = new EmbedRatePacer(1000, () => now, sleep);

    await pacer.waitForCapacity(700); // fits, sent at t=0
    expect(sleep).not.toHaveBeenCalled();

    await pacer.waitForCapacity(700); // 700+700=1400 > 1000 target -> must wait
    expect(sleep).toHaveBeenCalled();
  });

  it("proceeds once enough of the 60s window has aged out", async () => {
    let now = 0;
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      now += ms;
    });
    const pacer = new EmbedRatePacer(1000, () => now, sleep);

    await pacer.waitForCapacity(900); // sent at t=0
    await pacer.waitForCapacity(500); // must wait for the window to age out

    expect(sleep).toHaveBeenCalled();
    expect(now).toBeGreaterThanOrEqual(60_000);
  });
});
