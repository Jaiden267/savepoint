"use client";

import { useActionState, useState } from "react";
import {
  createReviewAction,
  updateReviewAction,
  deleteReviewAction,
} from "@/server/actions/reviews";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { StarRatingInput } from "@/components/games/star-rating-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/common/submit-button";
import { FormAlert } from "@/components/common/form-alert";
import { FieldError } from "@/components/common/field-error";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ExistingReview {
  id: string;
  rating: number;
  body: string;
  hasSpoilers: boolean;
}

interface ReviewComposerProps {
  gameId: string;
  gameSlug: string;
  existingReview: ExistingReview | null;
}

/**
 * Lives inline on /games/[slug] only — ties "one review per user/game" to
 * its natural context. /reviews/[id] never gets a second composer instance.
 * This review's rating is an independent snapshot, never user_games.rating
 * — see the rating-semantics invariant in docs/SOCIAL.md.
 */
export function ReviewComposer({
  gameId,
  gameSlug,
  existingReview,
}: ReviewComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const isEdit = Boolean(existingReview);
  const action = isEdit ? updateReviewAction : createReviewAction;
  const [deleteState, deleteAction] = useActionState(
    deleteReviewAction,
    initialActionState,
  );
  const [rating, setRating] = useState<number | null>(
    existingReview?.rating ?? null,
  );

  // Collapsing on success is handled here, as part of the action's own
  // result handling, rather than in a useEffect watching `state` — that
  // would call setState synchronously in an effect body, triggering an
  // avoidable extra render.
  async function handleAction(
    prevState: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    const result = await action(prevState, formData);
    if (result.status === "success") setExpanded(false);
    return result;
  }
  const [state, formAction] = useActionState(handleAction, initialActionState);

  if (!expanded) {
    return (
      <Button variant="outline" onClick={() => setExpanded(true)}>
        {isEdit ? "Edit your review" : "Write a review"}
      </Button>
    );
  }

  return (
    <div className="border-border rounded-lg border p-4">
      <form action={formAction} className="flex flex-col gap-4">
        {isEdit ? (
          <input type="hidden" name="reviewId" value={existingReview!.id} />
        ) : (
          <input type="hidden" name="gameId" value={gameId} />
        )}
        <input type="hidden" name="gameSlug" value={gameSlug} />
        <input type="hidden" name="rating" value={rating ?? ""} />

        <div className="flex flex-col gap-1.5">
          <span className="text-foreground text-sm font-medium">
            Your rating for this review
          </span>
          <StarRatingInput
            aria-label="Your rating for this review"
            value={rating}
            onChange={setRating}
            required
          />
          <p className="text-muted-foreground text-xs">
            Separate from your library rating — publishing this review
            won&apos;t change your library rating or the community average.
          </p>
          <FieldError id="rating-error" errors={state.fieldErrors?.rating} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-body">Review</Label>
          <Textarea
            id="review-body"
            name="body"
            rows={6}
            maxLength={10000}
            defaultValue={existingReview?.body ?? ""}
            required
          />
          <FieldError id="body-error" errors={state.fieldErrors?.body} />
        </div>

        <Label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="hasSpoilers"
            defaultChecked={existingReview?.hasSpoilers ?? false}
            className="border-input size-4 rounded"
          />
          Contains spoilers
        </Label>

        <FormAlert state={state} />

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <SubmitButton pendingText={isEdit ? "Saving…" : "Publishing…"}>
              {isEdit ? "Save changes" : "Publish review"}
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setExpanded(false)}
            >
              Cancel
            </Button>
          </div>

          {isEdit ? (
            <Dialog>
              <DialogTrigger
                className={cn(
                  buttonVariants({ variant: "destructive", size: "sm" }),
                )}
              >
                Delete review
              </DialogTrigger>
              <DialogPopup>
                <DialogTitle>Delete this review?</DialogTitle>
                <DialogDescription>
                  This can&apos;t be undone. Your library rating and diary
                  entries for this game are not affected.
                </DialogDescription>
                <div className="mt-4 flex justify-end gap-2">
                  <DialogClose
                    className={cn(buttonVariants({ variant: "secondary" }))}
                  >
                    Cancel
                  </DialogClose>
                  <form action={deleteAction}>
                    <input
                      type="hidden"
                      name="reviewId"
                      value={existingReview!.id}
                    />
                    <input type="hidden" name="gameSlug" value={gameSlug} />
                    <SubmitButton variant="destructive" pendingText="Deleting…">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </DialogPopup>
            </Dialog>
          ) : null}
        </div>
      </form>
      <FormAlert state={deleteState} />
    </div>
  );
}
