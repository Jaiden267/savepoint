"use client";

import { useActionState } from "react";
import { deleteDiaryEntryAction } from "@/server/actions/diary";
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

/** Dialog-confirmed delete for a single /diary row — mirrors StatusSelector's Remove confirmation pattern. */
export function DeleteDiaryEntryButton({
  entryId,
  gameSlug,
}: {
  entryId: string;
  gameSlug: string;
}) {
  const [state, formAction] = useActionState(
    deleteDiaryEntryAction,
    initialActionState,
  );

  return (
    <Dialog>
      <DialogTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
      >
        Delete
      </DialogTrigger>
      <DialogPopup>
        <DialogTitle>Delete this diary entry?</DialogTitle>
        <DialogDescription>
          This can&apos;t be undone. Your library rating and any review for this
          game are not affected.
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose className={cn(buttonVariants({ variant: "secondary" }))}>
            Cancel
          </DialogClose>
          <form action={formAction}>
            <input type="hidden" name="entryId" value={entryId} />
            <input type="hidden" name="gameSlug" value={gameSlug} />
            <SubmitButton variant="destructive" pendingText="Deleting…">
              Delete
            </SubmitButton>
          </form>
        </div>
        <FormAlert state={state} />
      </DialogPopup>
    </Dialog>
  );
}
