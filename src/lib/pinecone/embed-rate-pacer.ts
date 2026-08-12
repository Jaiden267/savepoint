// Deliberately NOT `server-only` — pure timing/accounting logic, no
// secrets, no network access. scripts/igdb-catalogue-sync.mts (a plain
// Node script outside Next's bundler) imports this directly.
import {
  PINECONE_PASSAGE_TOKENS_PER_MINUTE_TARGET,
  EMBEDDING_TOKEN_SAFETY_MULTIPLIER,
} from "./constants.ts";

const WINDOW_MS = 60_000;

/**
 * Proactive per-minute token pacer for Pinecone's passage/upsert
 * embedding throughput — a real, separate constraint from the monthly
 * embedding-token budget (confirmed live: Starter plan allows
 * 250,000 tokens/minute for llama-text-embed-v2 passage embedding,
 * project-wide, shared with ordinary Savepoint traffic — see
 * docs/PINECONE.md). Paces to `PINECONE_PASSAGE_TOKENS_PER_MINUTE_TARGET`
 * (60% of the documented limit), deliberately leaving headroom for
 * concurrent organic on-demand syncs and for this estimate's own ±30%
 * uncertainty, rather than chasing the full limit for itself.
 *
 * `Retry-After`/exponential-backoff handling on real 429 responses
 * (implemented separately in the sync script) remains as a backstop for
 * whatever this proactive estimate doesn't perfectly predict — the two
 * are complementary, not either/or.
 */
export class EmbedRatePacer {
  private sent: { atMs: number; tokens: number }[] = [];
  // Not TS parameter-properties — Node's native strip-only TypeScript mode
  // (used to run scripts/igdb-catalogue-sync.mts, this module's caller,
  // directly) doesn't support that syntax.
  private readonly targetTokensPerMinute: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    targetTokensPerMinute = PINECONE_PASSAGE_TOKENS_PER_MINUTE_TARGET,
    now: () => number = Date.now,
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.targetTokensPerMinute = targetTokensPerMinute;
    this.now = now;
    this.sleep = sleep;
  }

  /** Estimated tokens for a batch of embedding-text character counts, with the shared 1.3x safety multiplier applied. */
  static estimateTokens(charCounts: number[]): number {
    const rawTokens = charCounts.reduce((sum, chars) => sum + chars / 4, 0);
    return Math.ceil(rawTokens * EMBEDDING_TOKEN_SAFETY_MULTIPLIER);
  }

  private prune(now: number): void {
    this.sent = this.sent.filter((entry) => now - entry.atMs < WINDOW_MS);
  }

  private windowTotal(now: number): number {
    this.prune(now);
    return this.sent.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  /** Blocks (sleeping, not busy-waiting) until sending `tokens` more would not push the trailing 60s window over the pacing target, then records the send. */
  async waitForCapacity(tokens: number): Promise<void> {
    for (;;) {
      const now = this.now();
      const currentTotal = this.windowTotal(now);
      if (currentTotal + tokens <= this.targetTokensPerMinute) {
        this.sent.push({ atMs: now, tokens });
        return;
      }
      const oldest = this.sent[0];
      const waitMs = oldest
        ? Math.max(1, WINDOW_MS - (now - oldest.atMs))
        : WINDOW_MS;
      await this.sleep(waitMs);
    }
  }
}
