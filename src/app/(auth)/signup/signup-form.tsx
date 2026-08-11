"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction } from "@/server/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/common/field-error";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";

export function SignupForm() {
  const [state, formAction] = useActionState(signUpAction, initialActionState);

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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
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
        <Label htmlFor="confirmPassword">Confirm password</Label>
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

      <SubmitButton className="mt-2 w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
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
