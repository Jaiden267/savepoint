"use client";

import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { igdbImageUrl } from "@/lib/igdb/image-url";
import {
  updateListItemNoteAction,
  removeListItemAction,
} from "@/server/actions/lists";
import { initialActionState } from "@/lib/action-state";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";
import { Textarea } from "@/components/ui/textarea";

export interface ListItemRowData {
  id: string;
  gameSlug: string;
  gameName: string;
  coverImageId: string | null;
  note: string | null;
}

interface ListItemRowProps {
  listId: string;
  item: ListItemRowData;
  /** Owner-only reorder buttons, rendered by the caller (ListItemsManager) so this component stays agnostic of overall list order. */
  reorderControls?: ReactNode;
  /** Read-only rendering for a visitor viewing someone else's list — no note editor, no remove button. */
  canEdit: boolean;
}

export function ListItemRow({
  listId,
  item,
  reorderControls,
  canEdit,
}: ListItemRowProps) {
  const [noteState, noteAction] = useActionState(
    updateListItemNoteAction,
    initialActionState,
  );
  const [removeState, removeAction] = useActionState(
    removeListItemAction,
    initialActionState,
  );

  return (
    <div className="border-border flex gap-3 rounded-lg border p-3">
      {reorderControls}
      <Link
        href={`/games/${item.gameSlug}`}
        className="bg-muted relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded"
      >
        {item.coverImageId ? (
          <Image
            src={igdbImageUrl(item.coverImageId, "cover_small")}
            alt=""
            fill
            sizes="56px"
            className="object-cover"
          />
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/games/${item.gameSlug}`}
            className="text-foreground text-sm font-medium hover:underline"
          >
            {item.gameName}
          </Link>
          {canEdit ? (
            <form action={removeAction}>
              <input type="hidden" name="listId" value={listId} />
              <input type="hidden" name="itemId" value={item.id} />
              <SubmitButton variant="ghost" size="sm" pendingText="Removing…">
                Remove
              </SubmitButton>
            </form>
          ) : null}
        </div>

        {canEdit ? (
          <form action={noteAction} className="flex flex-col gap-1.5">
            <input type="hidden" name="listId" value={listId} />
            <input type="hidden" name="itemId" value={item.id} />
            <Textarea
              name="note"
              rows={2}
              maxLength={1000}
              placeholder="Add a note (optional)"
              defaultValue={item.note ?? ""}
            />
            <div className="flex justify-end">
              <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
                Save note
              </SubmitButton>
            </div>
          </form>
        ) : item.note ? (
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {item.note}
          </p>
        ) : null}

        {canEdit ? (
          <>
            <FormAlert state={noteState} />
            <FormAlert state={removeState} />
          </>
        ) : null}
      </div>
    </div>
  );
}
