"use client";

import { useActionState, useState } from "react";
import {
  updateReviewCommentAction,
  deleteReviewCommentAction,
} from "@/server/actions/reviews";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/common/submit-button";
import { FormAlert } from "@/components/common/form-alert";
import { Textarea } from "@/components/ui/textarea";
import { getInitials } from "@/lib/get-initials";

interface CommentItemProps {
  comment: { id: string; body: string; createdAt: string };
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  reviewId: string;
  isOwner: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Renders comment bodies as plain text via whitespace-pre-wrap — never dangerouslySetInnerHTML (see CLAUDE.md). */
export function CommentItem({
  comment,
  author,
  reviewId,
  isOwner,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false);

  async function handleUpdate(
    prevState: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    const result = await updateReviewCommentAction(prevState, formData);
    if (result.status === "success") setEditing(false);
    return result;
  }
  const [updateState, updateAction] = useActionState(
    handleUpdate,
    initialActionState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteReviewCommentAction,
    initialActionState,
  );

  return (
    <div className="border-border rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Avatar size="sm">
          {author.avatarUrl ? (
            <AvatarImage src={author.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback>
            {getInitials(author.displayName || author.username)}
          </AvatarFallback>
        </Avatar>
        <span className="text-foreground text-sm font-medium">
          {author.displayName || author.username}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatDate(comment.createdAt)}
        </span>
      </div>

      {editing ? (
        <form action={updateAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="commentId" value={comment.id} />
          <input type="hidden" name="reviewId" value={reviewId} />
          <Textarea
            name="body"
            rows={2}
            maxLength={2000}
            defaultValue={comment.body}
            required
          />
          <FormAlert state={updateState} />
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-foreground mt-2 text-sm whitespace-pre-wrap">
          {comment.body}
        </p>
      )}

      {isOwner && !editing ? (
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <form action={deleteAction}>
            <input type="hidden" name="commentId" value={comment.id} />
            <input type="hidden" name="reviewId" value={reviewId} />
            <SubmitButton variant="ghost" size="sm" pendingText="Deleting…">
              Delete
            </SubmitButton>
          </form>
        </div>
      ) : null}
      <FormAlert state={deleteState} />
    </div>
  );
}
