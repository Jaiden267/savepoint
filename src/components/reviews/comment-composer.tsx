"use client";

import { useActionState, useEffect, useRef } from "react";
import { createReviewCommentAction } from "@/server/actions/reviews";
import { initialActionState } from "@/lib/action-state";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/common/submit-button";
import { FormAlert } from "@/components/common/form-alert";

export function CommentComposer({ reviewId }: { reviewId: string }) {
  const [state, formAction] = useActionState(
    createReviewCommentAction,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <label className="sr-only" htmlFor="comment-body">
        Write a comment
      </label>
      <Textarea
        id="comment-body"
        name="body"
        rows={2}
        maxLength={2000}
        placeholder="Add a comment…"
        required
      />
      <FormAlert state={state} />
      <div className="flex justify-end">
        <SubmitButton size="sm" pendingText="Posting…">
          Post comment
        </SubmitButton>
      </div>
    </form>
  );
}
