"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { rateGameAction, clearRatingAction } from "@/server/actions/library";
import { initialActionState } from "@/lib/action-state";
import { StarRatingInput } from "@/components/games/star-rating-input";
import { SubmitButton } from "@/components/common/submit-button";
import { FormAlert } from "@/components/common/form-alert";

interface RatingControlProps {
  gameId: string;
  gameSlug: string;
  /** Stars (0.5–5), or null if not yet rated. This is user_games.rating — the one canonical, current rating that drives the game's aggregate score. */
  currentRating: number | null;
  /** Disabled until a user_games row exists (a status has been picked). */
  inLibrary: boolean;
}

function RatingFieldset({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={disabled} className="contents">
      {children}
    </fieldset>
  );
}

/** Writes user_games.rating — this is "Your rating," the single control that drives the game's aggregate score. Never confused with a diary or review rating, which are independent snapshots. */
export function RatingControl({
  gameId,
  gameSlug,
  currentRating,
  inLibrary,
}: RatingControlProps) {
  const [rateState, rateAction, ratePending] = useActionState(
    rateGameAction,
    initialActionState,
  );
  const [clearState, clearAction, clearPending] = useActionState(
    clearRatingAction,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  // Neither form's own useFormStatus can cover both siblings at once (it
  // only observes the nearest enclosing <form>), so pending state comes
  // from each action's own useActionState instead.
  const isBusy = ratePending || clearPending;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-foreground text-sm font-medium">Your rating</span>
      <div className="flex items-center gap-3">
        <form ref={formRef} action={rateAction}>
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="gameSlug" value={gameSlug} />
          <RatingFieldset disabled={!inLibrary || isBusy}>
            <StarRatingInput
              aria-label="Your rating"
              name="stars"
              defaultValue={currentRating}
              onChange={() => formRef.current?.requestSubmit()}
            />
          </RatingFieldset>
        </form>
        <form action={clearAction}>
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="gameSlug" value={gameSlug} />
          <SubmitButton
            variant="ghost"
            size="sm"
            pendingText="Clearing…"
            disabled={!inLibrary || currentRating === null || isBusy}
          >
            Clear
          </SubmitButton>
        </form>
      </div>
      {!inLibrary ? (
        <p className="text-muted-foreground text-xs">
          Add this game to your library to rate it.
        </p>
      ) : null}
      <FormAlert state={rateState} />
      <FormAlert state={clearState} />
    </div>
  );
}
