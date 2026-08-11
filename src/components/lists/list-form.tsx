"use client";

import { useActionState } from "react";
import { createListAction, updateListAction } from "@/server/actions/lists";
import { initialActionState } from "@/lib/action-state";
import { FormAlert } from "@/components/common/form-alert";
import { FieldError } from "@/components/common/field-error";
import { SubmitButton } from "@/components/common/submit-button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ListVisibility } from "@/lib/validation/lists";

interface ListFormDefaults {
  listId: string;
  title: string;
  description: string | null;
  visibility: ListVisibility;
  isRanked: boolean;
}

interface ListFormProps {
  /** Present => edit mode, pre-filled from an existing list. Absent => create mode, blank defaults. */
  defaults?: ListFormDefaults;
}

/** Handles both creating a new list and editing an existing one's metadata (title/description/visibility/ranked). Item management lives in ListItemsManager, a separate concern on the edit page. */
export function ListForm({ defaults }: ListFormProps) {
  const isEdit = Boolean(defaults);
  const action = isEdit ? updateListAction : createListAction;
  const [state, formAction] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? (
        <input type="hidden" name="listId" value={defaults!.listId} />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={defaults?.title ?? ""}
        />
        <FieldError id="title-error" errors={state.fieldErrors?.title} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={defaults?.description ?? ""}
        />
        <FieldError
          id="description-error"
          errors={state.fieldErrors?.description}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="visibility">Visibility</Label>
        <select
          id="visibility"
          name="visibility"
          defaultValue={defaults?.visibility ?? "public"}
          className="border-border bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
        >
          <option value="public">Public — visible to everyone</option>
          <option value="unlisted">
            Unlisted — visible with the link, hidden from discovery
          </option>
          <option value="private">Private — visible only to you</option>
        </select>
      </div>

      <Label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isRanked"
          defaultChecked={defaults?.isRanked ?? false}
          className="border-input size-4 rounded"
        />
        Ranked list (items have an explicit order)
      </Label>

      <FormAlert state={state} />

      <div className="flex justify-end">
        <SubmitButton pendingText={isEdit ? "Saving…" : "Creating…"}>
          {isEdit ? "Save changes" : "Create list"}
        </SubmitButton>
      </div>
    </form>
  );
}
