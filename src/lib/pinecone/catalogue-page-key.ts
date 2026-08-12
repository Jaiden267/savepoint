import { createHash } from "node:crypto";

/**
 * Pure, deterministic idempotency-key construction for
 * `advance_catalogue_discovery`'s `p_page_key`/`p_expected_previous_page_key`
 * arguments. Not `server-only` — imported by both application code
 * (`scripts/igdb-catalogue-sync.mts`, a plain Node script) and its tests.
 *
 * The key is built from the *complete* canonical mutation payload, not just
 * candidate ids: every candidate's own metadata, the ineligible-id set, every
 * compound cursor value the call would advance, and the completion flag.
 * Two calls that would mutate the ledger identically always produce the same
 * key; anything that differs in what it would actually apply produces a
 * different one — which is what makes the RPC's compare-and-set meaningful
 * rather than a coincidental collision.
 */

export interface CatalogueCandidateInput {
  igdbId: number;
  profile: string;
  igdbUpdatedAtUnix: number;
}

export interface CataloguePageKeyInput {
  cursorName: string;
  candidates: CatalogueCandidateInput[];
  markIneligible: number[];
  newLastIgdbId: number | null;
  newLastUpdatedAtUnix: number | null;
  newLastUpdatedAtIgdbId: number | null;
  newLastReleaseCheckUnix: number | null;
  newLastReleaseCheckIgdbId: number | null;
  markCompleted: boolean;
}

function field(value: number | null): string {
  return value === null ? "" : String(value);
}

export function buildCataloguePageKey(input: CataloguePageKeyInput): string {
  const normalizedCandidates = [...input.candidates]
    .sort((a, b) => a.igdbId - b.igdbId)
    .map((c) => `${c.igdbId}:${c.profile}:${c.igdbUpdatedAtUnix}`)
    .join(",");
  const normalizedIneligible = [...input.markIneligible]
    .sort((a, b) => a - b)
    .join(",");

  const canonical = [
    input.cursorName,
    normalizedCandidates,
    normalizedIneligible,
    field(input.newLastIgdbId),
    field(input.newLastUpdatedAtUnix),
    field(input.newLastUpdatedAtIgdbId),
    field(input.newLastReleaseCheckUnix),
    field(input.newLastReleaseCheckIgdbId),
    input.markCompleted ? "1" : "0",
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex");
}
