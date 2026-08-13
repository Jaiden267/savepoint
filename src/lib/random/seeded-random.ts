/**
 * Deterministic PRNG (mulberry32) and helpers built on it — no framework
 * dependency, so both server code and tests can use the exact same
 * sequence given the same seed. Used by discover-catalogue.ts to make a
 * whole request's threshold picks and final shuffle order a pure
 * function of the URL's `?seed=` value: same seed in, same selection
 * out, every time.
 */

/** A 32-bit unsigned integer seed. */
export type Seed = number;

/** Stateful closure yielding floats in [0, 1) — call repeatedly to advance the sequence. */
export type Rng = () => number;

/** mulberry32 — small, fast, well-distributed enough for non-cryptographic sampling/shuffling. Same seed always produces the same infinite sequence. */
export function createSeededRandom(seed: Seed): Rng {
  let state = seed >>> 0;
  return function rng(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws `count` integer threshold values in the inclusive range
 * `[min, max]` from `rng`. Not deduplicated — the caller (a keyset seek
 * per threshold) tolerates and even benefits from independent draws,
 * and near-duplicate thresholds are harmless, just slightly redundant.
 */
export function pickKeysetThresholds(
  rng: Rng,
  min: number,
  max: number,
  count: number,
): number[] {
  if (max < min) {
    throw new RangeError(`pickKeysetThresholds: max (${max}) < min (${min})`);
  }
  const span = max - min + 1;
  const thresholds: number[] = [];
  for (let i = 0; i < count; i++) {
    thresholds.push(min + Math.floor(rng() * span));
  }
  return thresholds;
}

/** Fisher–Yates shuffle using `rng` — returns a new array, never mutates `items`. */
export function seededShuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}
