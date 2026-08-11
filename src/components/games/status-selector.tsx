"use client";

import { useActionState, useRef } from "react";
import {
  setGameStatusAction,
  removeFromLibraryAction,
} from "@/server/actions/library";
import { initialActionState } from "@/lib/action-state";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LibraryStatus } from "@/lib/validation/library";

const STATUS_OPTIONS: { value: LibraryStatus; label: string }[] = [
  { value: "wishlist", label: "Wishlist" },
  { value: "backlog", label: "Backlog" },
  { value: "playing", label: "Playing" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "dropped", label: "Dropped" },
];

interface StatusSelectorProps {
  gameId: string;
  gameSlug: string;
  currentStatus: LibraryStatus | null;
}

export function StatusSelector({
  gameId,
  gameSlug,
  currentStatus,
}: StatusSelectorProps) {
  const [statusState, statusAction] = useActionState(
    setGameStatusAction,
    initialActionState,
  );
  const [removeState, removeAction] = useActionState(
    removeFromLibraryAction,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <form ref={formRef} action={statusAction} className="flex-1">
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="gameSlug" value={gameSlug} />
          <label className="sr-only" htmlFor="status-select">
            Library status
          </label>
          <select
            id="status-select"
            name="status"
            defaultValue={currentStatus ?? ""}
            onChange={() => formRef.current?.requestSubmit()}
            className="border-border bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
          >
            <option value="" disabled>
              Add to library…
            </option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </form>

        {currentStatus ? (
          <Dialog>
            <DialogTrigger
              className={cn(
                buttonVariants({ variant: "destructive", size: "sm" }),
              )}
            >
              Remove
            </DialogTrigger>
            <DialogPopup>
              <DialogTitle>Remove from library?</DialogTitle>
              <DialogDescription>
                This removes the game from your library and clears your rating.
                Your diary entries and any review you&apos;ve written for it are
                not affected.
              </DialogDescription>
              <div className="mt-4 flex justify-end gap-2">
                <DialogClose
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  Cancel
                </DialogClose>
                <form action={removeAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="gameSlug" value={gameSlug} />
                  <SubmitButton variant="destructive" pendingText="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              </div>
            </DialogPopup>
          </Dialog>
        ) : null}
      </div>
      <FormAlert state={statusState} />
      <FormAlert state={removeState} />
    </div>
  );
}
