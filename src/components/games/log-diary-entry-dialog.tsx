"use client";

import { useActionState, useState } from "react";
import {
  logDiaryEntryAction,
  updateDiaryEntryAction,
} from "@/server/actions/diary";
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
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

interface DiaryEntryDefaults {
  entryId: string;
  playedOn: string;
  rating: number | null;
  isReplay: boolean;
  note: string | null;
}

interface LogDiaryEntryDialogProps {
  gameId: string;
  gameSlug: string;
  triggerLabel: string;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerSize?: VariantProps<typeof buttonVariants>["size"];
  /** Present => edit mode, pre-filled from an existing entry. Absent => create mode, blank/today. */
  defaults?: DiaryEntryDefaults;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Handles both logging a new play (create) and editing an existing entry
 * (defaults provided). This entry's rating is an independent per-playthrough
 * snapshot — never the library rating — and the note is PUBLIC, never
 * described as private (see the rating-semantics invariant in
 * docs/SOCIAL.md).
 */
export function LogDiaryEntryDialog({
  gameId,
  gameSlug,
  triggerLabel,
  triggerVariant = "outline",
  triggerSize = "default",
  defaults,
}: LogDiaryEntryDialogProps) {
  const isEdit = Boolean(defaults);
  const action = isEdit ? updateDiaryEntryAction : logDiaryEntryAction;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(defaults?.rating ?? null);

  // Closing on success is handled here, as part of the action's own result
  // handling, rather than in a useEffect watching `state` — that would call
  // setState synchronously in an effect body, triggering an avoidable extra
  // render (see search-command-dialog.tsx for the same fix applied to a
  // different case).
  async function handleAction(
    prevState: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    const result = await action(prevState, formData);
    if (result.status === "success") setOpen(false);
    return result;
  }
  const [state, formAction] = useActionState(handleAction, initialActionState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          buttonVariants({ variant: triggerVariant, size: triggerSize }),
        )}
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogPopup>
        <DialogTitle>{isEdit ? "Edit diary entry" : "Log a play"}</DialogTitle>
        <DialogDescription>
          Track when you played this game — separate from your library rating
          and any review you write.
        </DialogDescription>
        <form action={formAction} className="mt-4 flex flex-col gap-4">
          {isEdit ? (
            <input type="hidden" name="entryId" value={defaults!.entryId} />
          ) : (
            <input type="hidden" name="gameId" value={gameId} />
          )}
          <input type="hidden" name="gameSlug" value={gameSlug} />
          <input type="hidden" name="rating" value={rating ?? ""} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="playedOn">Date played</Label>
            <input
              id="playedOn"
              name="playedOn"
              type="date"
              required
              defaultValue={defaults?.playedOn ?? todayIsoDate()}
              max={todayIsoDate()}
              className="border-border bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            />
            <FieldError
              id="playedOn-error"
              errors={state.fieldErrors?.playedOn}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground text-sm font-medium">
                Rating for this playthrough (optional)
              </span>
              {rating !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRating(null)}
                >
                  Clear rating
                </Button>
              ) : null}
            </div>
            <StarRatingInput
              aria-label="Rating for this playthrough"
              value={rating}
              onChange={setRating}
            />
            <p className="text-muted-foreground text-xs">
              Separate from your library rating — this won&apos;t change your
              library rating or the community average.
            </p>
          </div>

          <Label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isReplay"
              defaultChecked={defaults?.isReplay ?? false}
              className="border-input size-4 rounded"
            />
            This was a replay
          </Label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Diary note (optional)</Label>
            <Textarea
              id="note"
              name="note"
              rows={3}
              maxLength={2000}
              defaultValue={defaults?.note ?? ""}
            />
            <p className="text-muted-foreground text-xs">
              Visible to anyone who views your diary or this game — not private.
            </p>
            <FieldError id="note-error" errors={state.fieldErrors?.note} />
          </div>

          <FormAlert state={state} />

          <div className="flex justify-end gap-2">
            <SubmitButton pendingText={isEdit ? "Saving…" : "Logging…"}>
              {isEdit ? "Save changes" : "Log play"}
            </SubmitButton>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
