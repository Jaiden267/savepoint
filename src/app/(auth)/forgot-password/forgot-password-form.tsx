"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "@/server/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/common/field-error";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    forgotPasswordAction,
    initialActionState,
  );

  if (state.status === "success") {
    return <FormAlert state={state} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={
            state.fieldErrors?.email ? "email-error" : undefined
          }
        />
        <FieldError id="email-error" errors={state.fieldErrors?.email} />
      </div>

      <SubmitButton className="mt-2 w-full" pendingText="Sending link…">
        Send reset link
      </SubmitButton>

      <p className="text-muted-foreground text-center text-sm">
        Remembered it after all?{" "}
        <Link
          href="/login"
          className="text-foreground underline underline-offset-2"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
