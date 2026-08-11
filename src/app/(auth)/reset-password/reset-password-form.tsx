"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/server/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/common/field-error";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(
    resetPasswordAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : "password-hint"
          }
        />
        <p id="password-hint" className="text-muted-foreground text-xs">
          At least 8 characters.
        </p>
        <FieldError id="password-error" errors={state.fieldErrors?.password} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
          aria-describedby={
            state.fieldErrors?.confirmPassword
              ? "confirmPassword-error"
              : undefined
          }
        />
        <FieldError
          id="confirmPassword-error"
          errors={state.fieldErrors?.confirmPassword}
        />
      </div>

      <SubmitButton className="mt-2 w-full" pendingText="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
