"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import { logActionError } from "@/server/actions/log-action-error";
import {
  recordClick,
  SHOWN_EXCLUSION_WINDOW_MS,
} from "@/server/services/recommendations";
import { invalidateCacheByPrefix } from "@/lib/igdb/search-cache";
import {
  checkCatalogueImportRateLimit,
  importGameByIgdbId,
} from "@/server/services/game-sync";
import { syncGameVector } from "@/lib/pinecone/sync";
import {
  recommendationIgdbIdSchema,
  recommendationFeedbackEventTypeSchema,
  recommendationImpressionBatchSchema,
} from "@/lib/validation/recommendations";
import { catalogueImportIgdbIdSchema } from "@/lib/validation/games";
import type { ActionState } from "@/lib/action-state";

export interface ToggleRecommendationFeedbackResult {
  status: "success" | "error";
  active: boolean;
  message?: string;
}

const FEEDBACK_RATE_LIMIT = { limit: 120, windowSeconds: 60 * 60 };

/**
 * Called directly from a client transition (like toggleReviewLikeAction/
 * toggleFollowAction), not via `<form>` — validates its actual runtime
 * arguments before any auth check or database call. Only `igdbId` and
 * `eventType` ever reach this function — `user_id` always comes from the
 * authenticated session, and `game_id` is always resolved server-side by
 * looking up `games` from the validated `igdbId`, never accepted as a
 * parameter. A "flip whatever's currently there" toggle (query current
 * state, then insert or delete) rather than the client dictating the next
 * state, since (unlike a like/follow button) a `dismissed`/`completed`
 * feedback row also excludes the game from future results, so the game
 * showing up again with stale client-side "not yet saved" state is
 * already structurally rare.
 */
export async function toggleRecommendationFeedbackAction(
  igdbId: number,
  eventType: string,
): Promise<ToggleRecommendationFeedbackResult> {
  const parsedIgdbId = recommendationIgdbIdSchema.safeParse(igdbId);
  const parsedEventType =
    recommendationFeedbackEventTypeSchema.safeParse(eventType);
  if (!parsedIgdbId.success || !parsedEventType.success) {
    return { status: "error", active: false, message: "Invalid request." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Deliberately does NOT redirect (unlike requireUser) — a background
  // redirect from a feedback-button click would be jarring, and this
  // control is never rendered for a signed-out viewer regardless.
  if (!user) {
    return {
      status: "error",
      active: false,
      message: "Sign in to leave feedback.",
    };
  }

  const rate = checkRateLimit(
    `recommendation-feedback:${user.id}`,
    FEEDBACK_RATE_LIMIT,
  );
  if (!rate.allowed) {
    return {
      status: "error",
      active: false,
      message: "Too many requests. Please wait a bit and try again.",
    };
  }

  const { data: existing } = await supabase
    .from("recommendation_feedback")
    .select("id")
    .eq("user_id", user.id)
    .eq("igdb_id", parsedIgdbId.data)
    .eq("event_type", parsedEventType.data)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("recommendation_feedback")
      .delete()
      .eq("id", existing.id);
    if (error) {
      logActionError("toggleRecommendationFeedbackAction:remove", error);
      return {
        status: "error",
        active: true,
        message: "Couldn't update your feedback. Please try again.",
      };
    }
    invalidateCacheByPrefix(`recommendations:${user.id}:`);
    return { status: "success", active: false };
  }

  const { data: game } = await supabase
    .from("games")
    .select("id")
    .eq("igdb_id", parsedIgdbId.data)
    .maybeSingle();

  const { error } = await supabase.from("recommendation_feedback").insert({
    user_id: user.id,
    igdb_id: parsedIgdbId.data,
    game_id: game?.id ?? null,
    event_type: parsedEventType.data,
  });
  // A 23505 (already active — a race with another tab) is treated as
  // success, matching review_likes'/follows' exact toggle-idempotency
  // pattern — now backed by a real partial-unique index
  // (recommendation_feedback_toggle_unique) rather than a composite PK,
  // but the same swallow-and-treat-as-success handling applies.
  if (error && error.code !== "23505") {
    logActionError("toggleRecommendationFeedbackAction:add", error);
    return {
      status: "error",
      active: false,
      message: "Couldn't save your feedback. Please try again.",
    };
  }

  invalidateCacheByPrefix(`recommendations:${user.id}:`);
  return { status: "success", active: true };
}

/**
 * Records a batch of real impressions — called by
 * recommendation-impression-tracker.tsx only after the grid has actually
 * committed to the DOM client-side (never from a server-side data fetch;
 * see docs/RECOMMENDATIONS.md). `igdbIds` is validated, deduped, and
 * capped; only ids not already `shown` within SHOWN_EXCLUSION_WINDOW_MS
 * are inserted (never an "entire batch looks recent, skip everything"
 * check, which would wrongly re-skip the genuinely-new portion of a
 * partially-overlapping batch) — one bounded lookup query, then at most
 * one bounded multi-row insert, never one call per id. A legitimate new
 * batch structurally can't contain an id that's genuinely `shown` within
 * the window, since buildExclusionSet already filters those out at
 * candidate-selection time — so any overlap found here is necessarily a
 * retry/double-fire artifact, making this window correct for idempotency
 * too, not just exclusion.
 */
export async function recordRecommendationImpressionsAction(
  igdbIds: number[],
): Promise<void> {
  const parsed = recommendationImpressionBatchSchema.safeParse(igdbIds);
  if (!parsed.success || parsed.data.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const windowStart = new Date(
    Date.now() - SHOWN_EXCLUSION_WINDOW_MS,
  ).toISOString();
  const { data: recent } = await supabase
    .from("recommendation_feedback")
    .select("igdb_id")
    .eq("user_id", user.id)
    .eq("event_type", "shown")
    .in("igdb_id", parsed.data)
    .gte("created_at", windowStart);

  const alreadyShown = new Set((recent ?? []).map((r) => r.igdb_id));
  const newIgdbIds = parsed.data.filter((id) => !alreadyShown.has(id));
  if (newIgdbIds.length === 0) return;

  await supabase.from("recommendation_feedback").insert(
    newIgdbIds.map((igdbId) => ({
      user_id: user.id,
      igdb_id: igdbId,
      game_id: null,
      event_type: "shown",
    })),
  );
}

/**
 * Catalogue-only recommendation open: records the `clicked` feedback and
 * then performs the existing import in the same request — a real `<form>`
 * submission is already a request the browser waits on (unlike a same-page
 * `<Link>` click-then-navigate, which a beacon is needed for; see
 * src/app/api/recommendations/click/route.ts), so no separate beacon is
 * needed here. Reuses `importGameByIgdbId` directly (zero duplicated
 * import logic) and the same `catalogue-import:` rate-limit bucket as the
 * generic path, so recommendations don't get a separate, more generous
 * import budget. A failed click-record must never block the import.
 */
export async function importRecommendedCatalogueGameAction(
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    try {
      await recordClick(supabase, user.id, parsed.data);
    } catch {
      // Telemetry failure must never block the import.
    }
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
