"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

/** Submit button that shows a pending state via useFormStatus — must render inside the <form> it submits. */
export function SubmitButton({
  children,
  pendingText,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {pendingText ?? "Please wait…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
