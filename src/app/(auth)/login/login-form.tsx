"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction } from "@/server/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/common/field-error";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

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
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : undefined
          }
        />
        <FieldError id="password-error" errors={state.fieldErrors?.password} />
      </div>

      <SubmitButton className="mt-2 w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="text-foreground underline underline-offset-2"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}
