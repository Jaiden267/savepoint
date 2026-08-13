import { describe, it, expect } from "vitest";
import {
  createSeededRandom,
  pickKeysetThresholds,
  seededShuffle,
} from "./seeded-random";

describe("createSeededRandom", () => {
  it("produces the exact same sequence for the same seed", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("always yields values in [0, 1)", () => {
    const rng = createSeededRandom(12345);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("advances state — repeated calls differ from each other", () => {
    const rng = createSeededRandom(7);
    const values = Array.from({ length: 20 }, () => rng());
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});

describe("pickKeysetThresholds", () => {
  it("returns exactly `count` values, all within [min, max]", () => {
    const rng = createSeededRandom(99);
    const thresholds = pickKeysetThresholds(rng, 100, 200, 6);
    expect(thresholds).toHaveLength(6);
    for (const t of thresholds) {
      expect(t).toBeGreaterThanOrEqual(100);
      expect(t).toBeLessThanOrEqual(200);
      expect(Number.isInteger(t)).toBe(true);
    }
  });

  it("same seed → same threshold sequence (determinism)", () => {
    const a = pickKeysetThresholds(createSeededRandom(555), 0, 1_000_000, 4);
    const b = pickKeysetThresholds(createSeededRandom(555), 0, 1_000_000, 4);
    expect(a).toEqual(b);
  });

  it("handles min === max by always returning that single value", () => {
    const rng = createSeededRandom(1);
    const thresholds = pickKeysetThresholds(rng, 50, 50, 3);
    expect(thresholds).toEqual([50, 50, 50]);
  });

  it("throws when max < min", () => {
    const rng = createSeededRandom(1);
    expect(() => pickKeysetThresholds(rng, 50, 10, 3)).toThrow(RangeError);
  });
});

describe("seededShuffle", () => {
  it("returns a permutation — same multiset of elements, same length", () => {
    const rng = createSeededRandom(3);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = seededShuffle(rng, input);
    expect(shuffled).toHaveLength(input.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });

  it("does not mutate the input array", () => {
    const rng = createSeededRandom(3);
    const input = [1, 2, 3, 4, 5];
    const original = [...input];
    seededShuffle(rng, input);
    expect(input).toEqual(original);
  });

  it("same seed → identical shuffle order (stability across rerenders)", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const a = seededShuffle(createSeededRandom(2024), input);
    const b = seededShuffle(createSeededRandom(2024), input);
    expect(a).toEqual(b);
  });

  it("different seeds produce a different order (with overwhelming probability at this size)", () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    const a = seededShuffle(createSeededRandom(1), input);
    const b = seededShuffle(createSeededRandom(2), input);
    expect(a).not.toEqual(b);
  });

  it("handles an empty array", () => {
    const rng = createSeededRandom(1);
    expect(seededShuffle(rng, [])).toEqual([]);
  });

  it("handles a single-element array", () => {
    const rng = createSeededRandom(1);
    expect(seededShuffle(rng, ["only"])).toEqual(["only"]);
  });
});
