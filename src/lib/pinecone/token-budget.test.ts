import { describe, it, expect } from "vitest";
import { selectWithinTokenBudget } from "./token-budget";

// 400 chars -> 100 raw tokens -> a clean, easy-to-reason-about unit: after k
// such items, cumulative raw = 100k and cumulative margined = ceil(100k *
// 1.3) = 130k (already an integer for every integer k), matching
// EMBEDDING_TOKEN_SAFETY_MULTIPLIER from constants.ts.
function items(count: number, charCount = 400) {
  return Array.from({ length: count }, (_, i) => ({ index: i, charCount }));
}

describe("selectWithinTokenBudget", () => {
  it("selects everything when the full batch's margined estimate exceeds no allowance (Infinity — no ceiling in effect)", () => {
    const result = selectWithinTokenBudget(items(10), Number.POSITIVE_INFINITY);

    expect(result.selected).toHaveLength(10);
    expect(result.trimmed).toHaveLength(0);
  });

  it("trims a full batch that would exceed the remaining margined-token allowance", () => {
    // 5 items: cumulative margined = 130, 260, 390, 520, 650. Allowance of
    // 500 fits the first 3 (390) but not a 4th (520 > 500).
    const result = selectWithinTokenBudget(items(5), 500);

    expect(result.selected).toHaveLength(3);
    expect(result.selected.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(result.trimmed.map((r) => r.index)).toEqual([3, 4]);
    expect(result.rawTokens).toBe(300);
    expect(result.marginedTokens).toBe(390);
  });

  it("dynamically reduces a later batch as the remaining allowance shrinks across sequential calls", () => {
    // Batch A: allowance 1000, 3 items -> margined 390, all fit.
    const batchA = selectWithinTokenBudget(items(3), 1000);
    expect(batchA.selected).toHaveLength(3);
    expect(batchA.trimmed).toHaveLength(0);

    // Simulate the tracker spending batchA's margined tokens, then a
    // second, otherwise-identical 5-item batch only sees what's left.
    const spent = batchA.marginedTokens;
    const remainingAfterA = 1000 - spent; // 610
    const batchB = selectWithinTokenBudget(items(5), remainingAfterA);

    // Cumulative margined for batchB: 130, 260, 390, 520, 650 -> 650 > 610,
    // so only the first 4 fit — a smaller batch than batchA's, purely
    // because the allowance was already partly spent.
    expect(batchB.selected).toHaveLength(4);
    expect(batchB.trimmed).toHaveLength(1);
    expect(batchB.marginedTokens).toBe(520);
    expect(batchB.marginedTokens).toBeLessThan(batchA.marginedTokens + 200);
  });

  it("writes zero records when even the first record cannot fit the remaining allowance", () => {
    // A single item's own margined estimate is 130; an allowance of 100
    // can't fit it at all.
    const result = selectWithinTokenBudget(items(3), 100);

    expect(result.selected).toHaveLength(0);
    expect(result.trimmed).toHaveLength(3);
    expect(result.rawTokens).toBe(0);
    expect(result.marginedTokens).toBe(0);
  });

  it("accepts the full batch when the allowance exactly equals its margined estimate", () => {
    // 3 items -> margined exactly 390. An allowance of exactly 390 must
    // still accept all 3 (boundary is <=, not <).
    const result = selectWithinTokenBudget(items(3), 390);

    expect(result.selected).toHaveLength(3);
    expect(result.trimmed).toHaveLength(0);
    expect(result.marginedTokens).toBe(390);
  });

  it("reports raw and margined token estimates as distinct, correctly computed values", () => {
    // 1000 chars -> raw 250 tokens -> margined ceil(250 * 1.3) = 325.
    const result = selectWithinTokenBudget(
      [{ charCount: 1000 }],
      Number.POSITIVE_INFINITY,
    );

    expect(result.rawTokens).toBe(250);
    expect(result.marginedTokens).toBe(325);
    expect(result.marginedTokens).toBeGreaterThan(result.rawTokens);
  });

  it("never reorders items — trimmed is always the ordered suffix, not a best-fit selection", () => {
    // A big item first, then several small ones that would individually
    // fit — the big one still gets to go first (or not at all), never
    // skipped in favor of the smaller ones after it.
    const mixed = [
      { label: "big", charCount: 4000 }, // raw 1000, margined 1300 alone
      { label: "small-1", charCount: 40 },
      { label: "small-2", charCount: 40 },
    ];

    const result = selectWithinTokenBudget(mixed, 500);

    expect(result.selected).toHaveLength(0);
    expect(result.trimmed.map((r) => r.label)).toEqual([
      "big",
      "small-1",
      "small-2",
    ]);
  });
});
