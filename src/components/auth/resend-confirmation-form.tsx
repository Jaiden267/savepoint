"use client";

import { useActionState } from "react";
import { resendConfirmationAction } from "@/server/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/common/field-error";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";

/** Reusable resend-confirmation-email mini-form, embedded on both the
 * signup success screen (prefilled with the just-submitted email) and the
 * login page (empty, for a visitor who signed up earlier). */
export function ResendConfirmationForm({
  defaultEmail,
}: {
  defaultEmail?: string;
}) {
  const [state, formAction] = useActionState(
    resendConfirmationAction,
    initialActionState,
  );

  if (state.status === "success") {
    return <FormAlert state={state} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <FormAlert state={state} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resend-email">Email</Label>
        <Input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={defaultEmail}
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={
            state.fieldErrors?.email ? "resend-email-error" : undefined
          }
        />
        <FieldError id="resend-email-error" errors={state.fieldErrors?.email} />
      </div>

      <SubmitButton variant="outline" pendingText="Sending…">
        Resend confirmation email
      </SubmitButton>
    </form>
  );
}
