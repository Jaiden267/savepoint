"use client";

import { useActionState } from "react";
import { deleteListAction } from "@/server/actions/lists";
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

interface DeleteListButtonProps {
  listId: string;
  ownerUsername: string;
}

export function DeleteListButton({
  listId,
  ownerUsername,
}: DeleteListButtonProps) {
  const [state, formAction] = useActionState(
    deleteListAction,
    initialActionState,
  );

  return (
    <Dialog>
      <DialogTrigger className={cn(buttonVariants({ variant: "destructive" }))}>
        Delete list
      </DialogTrigger>
      <DialogPopup>
        <DialogTitle>Delete this list?</DialogTitle>
        <DialogDescription>
          This permanently removes the list and all its items. This can&apos;t
          be undone.
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose className={cn(buttonVariants({ variant: "secondary" }))}>
            Cancel
          </DialogClose>
          <form action={formAction}>
            <input type="hidden" name="listId" value={listId} />
            <input type="hidden" name="ownerUsername" value={ownerUsername} />
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
