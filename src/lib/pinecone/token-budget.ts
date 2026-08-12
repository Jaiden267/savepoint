// Deliberately NOT server-only — pure accounting logic, no secrets, no
// network access. scripts/igdb-catalogue-sync.mts (a plain Node script
// outside Next's bundler) imports this directly, same as
// embed-rate-pacer.ts/lease.ts.
import { EMBEDDING_TOKEN_SAFETY_MULTIPLIER } from "./constants.ts";

export interface TokenBudgetItem {
  charCount: number;
}

export interface TokenBudgetSelection<T extends TokenBudgetItem> {
  /** Ordered prefix of `items` that fits within `remainingAllowance`. */
  selected: T[];
  /** Ordered suffix left over — not sent this batch, left claimed-but-pending for a future run. */
  trimmed: T[];
  /** Sum of chars/4 across `selected` only, rounded up (for reporting alongside marginedTokens). */
  rawTokens: number;
  /** ceil(rawTokens-before-rounding * EMBEDDING_TOKEN_SAFETY_MULTIPLIER) across `selected` only — what actually counts against an operator's --max-estimated-embedding-tokens ceiling. Matches EmbedRatePacer.estimateTokens's exact formula, computed incrementally. */
  marginedTokens: number;
}

/**
 * Greedily selects the longest ordered PREFIX of `items` whose cumulative
 * margined token estimate never exceeds `remainingAllowance`. Never
 * reorders or skips ahead: the first item that would push the cumulative
 * estimate over the allowance, and everything after it, is trimmed.
 *
 * Exists because one IGDB catalogue-sync batch (up to BACKFILL_BATCH_SIZE
 * records) is sent to Pinecone in a single atomic upsert. The operator's
 * four ceilings are otherwise only checked *between* batches — not enough
 * when a batch's own size happens to equal --limit, since there's no
 * later batch-boundary check to catch an oversized one (this is exactly
 * what let Gate C's real canary run land ~1.8% over its declared
 * --max-estimated-embedding-tokens ceiling: BACKFILL_BATCH_SIZE == 25 ==
 * --limit, so the whole run was one batch). Call this before every
 * upsert — the command must never knowingly send a batch whose margined
 * estimate would exceed the caller's remaining allowance, regardless of
 * how batch size and --limit happen to compare.
 *
 * `remainingAllowance` of `Infinity` (no --max-estimated-embedding-tokens
 * ceiling in effect) selects everything.
 */
export function selectWithinTokenBudget<T extends TokenBudgetItem>(
  items: readonly T[],
  remainingAllowance: number,
): TokenBudgetSelection<T> {
  const selected: T[] = [];
  let cumulativeRawTokens = 0;
  let cumulativeMarginedTokens = 0;
  let cutIndex = items.length;

  for (let i = 0; i < items.length; i += 1) {
    const candidateRawTokens = cumulativeRawTokens + items[i]!.charCount / 4;
    const candidateMarginedTokens = Math.ceil(
      candidateRawTokens * EMBEDDING_TOKEN_SAFETY_MULTIPLIER,
    );
    if (candidateMarginedTokens > remainingAllowance) {
      cutIndex = i;
      break;
    }
    selected.push(items[i]!);
    cumulativeRawTokens = candidateRawTokens;
    cumulativeMarginedTokens = candidateMarginedTokens;
  }

  return {
    selected,
    trimmed: items.slice(cutIndex),
    rawTokens: Math.ceil(cumulativeRawTokens),
    marginedTokens: cumulativeMarginedTokens,
  };
}
