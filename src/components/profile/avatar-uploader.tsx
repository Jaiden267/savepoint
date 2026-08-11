"use client";

import { useActionState, useRef, useState, type ChangeEvent } from "react";
import {
  uploadAvatarAction,
  removeAvatarAction,
} from "@/server/actions/profile";
import { initialActionState } from "@/lib/action-state";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  avatarFileSchema,
} from "@/lib/validation/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/common/submit-button";
import { FormAlert } from "@/components/common/form-alert";

export function AvatarUploader({
  avatarUrl,
  initials,
}: {
  avatarUrl: string | null;
  initials: string;
}) {
  const [uploadState, uploadAction, isUploading] = useActionState(
    uploadAvatarAction,
    initialActionState,
  );
  const [removeState, removeAction] = useActionState(
    removeAvatarAction,
    initialActionState,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setClientError(null);
    if (!file) return;

    const parsed = avatarFileSchema.safeParse(file);
    if (!parsed.success) {
      setClientError(
        parsed.error.issues[0]?.message ?? "That image can't be used.",
      );
      event.target.value = "";
      return;
    }

    setPreview(URL.createObjectURL(file));
    formRef.current?.requestSubmit();
  }

  const displaySrc = preview ?? avatarUrl ?? undefined;

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16" size="lg">
        {displaySrc ? <AvatarImage src={displaySrc} alt="" /> : null}
        <AvatarFallback className="text-base">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex flex-1 flex-col gap-2">
        {/*
          The file input lives in its own form so requestSubmit() can submit
          just this field. The visible buttons below are deliberately NOT
          nested inside it — the Remove button needs its own <form> for
          independent pending state via useActionState, and a <form> inside
          a <form> is invalid HTML that browsers silently fail to submit.
        */}
        <form ref={formRef} action={uploadAction}>
          <input
            ref={fileInputRef}
            type="file"
            name="avatar"
            accept={AVATAR_ALLOWED_MIME_TYPES.join(",")}
            onChange={handleFileChange}
            className="sr-only"
            id="avatar-input"
            aria-label="Upload avatar image"
          />
        </form>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? "Uploading…" : "Upload photo"}
          </Button>
          {avatarUrl ? (
            <SubmitButtonInForm
              action={removeAction}
              label="Remove"
              pendingLabel="Removing…"
            />
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          PNG, JPEG or WebP. Max 5MB.
        </p>
        {clientError ? (
          <p className="text-destructive text-xs">{clientError}</p>
        ) : null}
        <FormAlert state={uploadState} />
        <FormAlert state={removeState} />
      </div>
    </div>
  );
}

/** Tiny standalone form so "Remove" has its own submit/pending state, independent of the upload form above. */
function SubmitButtonInForm({
  action,
  label,
  pendingLabel,
}: {
  action: (formData: FormData) => void;
  label: string;
  pendingLabel: string;
}) {
  return (
    <form action={action}>
      <SubmitButton variant="ghost" size="sm" pendingText={pendingLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}
