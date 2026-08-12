"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import {
  checkCatalogueImportRateLimit,
  importGameByIgdbId,
} from "@/server/services/game-sync";
import { syncGameVector } from "@/lib/pinecone/sync";
import { catalogueImportIgdbIdSchema } from "@/lib/validation/games";
import type { ActionState } from "@/lib/action-state";

/**
 * The explicit, rate-limited POST boundary for opening a catalogue-only
 * semantic search result (a game Pinecone found but Savepoint hasn't
 * cached). Deliberately NOT a plain `<Link href="/games/[slug]">` — see
 * docs/PINECONE.md's "on-demand import boundary" section for the full
 * reasoning, but in short: this prompt makes tens of thousands of
 * additional real, legitimate, semantically-discoverable game URLs
 * reachable through Savepoint's own UI for the first time, and a plain
 * GET-triggered import (the existing, still-correct pattern
 * `/games/[slug]` itself uses) is conventionally assumed safe/
 * side-effect-free by crawlers and link-preview bots, which a client-side
 * `prefetch={false}` hint doesn't stop. A real POST, gated behind an
 * explicit user action, doesn't have that problem.
 *
 * Reuses `importGameByIgdbId` unchanged (already idempotent, already
 * race-safe via `games.igdb_id`'s unique-constraint upsert) — zero new
 * import logic, only a new, narrower entry point to the existing one.
 */
export async function importCatalogueGameAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = catalogueImportIgdbIdSchema.safeParse(formData.get("igdbId"));
  if (!parsed.success) {
    return { status: "error", message: "That game couldn't be opened." };
  }

  const clientId = await getClientIdentifier();
  const rate = checkCatalogueImportRateLimit(clientId);
  if (!rate.allowed) {
    return {
      status: "error",
      message: "Too many games opened at once. Please try again shortly.",
    };
  }

  let game;
  try {
    game = await importGameByIgdbId(parsed.data);
  } catch {
    return {
      status: "error",
      message: "That game couldn't be imported right now. Please try again.",
    };
  }

  after(() => {
    syncGameVector(game.id).catch(() => {});
  });

  redirect(`/games/${game.slug}`);
}
