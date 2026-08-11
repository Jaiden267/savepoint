"use client";

import { useActionState, useEffect, useState } from "react";
import { usernameSchema } from "@/lib/validation/auth";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/common/field-error";
import { FormAlert } from "@/components/common/form-alert";
import { SubmitButton } from "@/components/common/submit-button";
import { cn } from "@/lib/utils";

type Availability = "idle" | "checking" | "available" | "taken" | "invalid";
type ProfileFormAction = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

/**
 * Shared username + display name + bio form, used by both /onboarding
 * (first completion) and /settings/profile (later edits) — same fields,
 * same validation, same live username-availability check. Only the
 * server action and button copy differ between the two callers.
 */
export function ProfileForm({
  action,
  initialUsername,
  initialDisplayName,
  initialBio,
  submitLabel,
  pendingLabel,
}: {
  action: ProfileFormAction;
  initialUsername: string;
  initialDisplayName: string;
  initialBio: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [username, setUsername] = useState(initialUsername);
  // Only genuinely async-dependent outcomes live in state — "invalid"/
  // "idle"/"available-because-it's-already-yours" are all pure functions
  // of `username`/`initialUsername` alone (see `availability` below), so
  // they're computed at render time rather than set from an effect.
  const [checkResult, setCheckResult] = useState<
    "checking" | "available" | "taken"
  >("available");

  const parsedUsername = usernameSchema.safeParse(username);
  const isOwnUsername =
    parsedUsername.success && parsedUsername.data === initialUsername;

  useEffect(() => {
    if (!parsedUsername.success || isOwnUsername) {
      // Nothing to check remotely — the render-time `availability` below
      // already covers both cases without needing a state update. (The
      // input's onChange handler already set "checking" synchronously on
      // this keystroke; if it turns out nothing needs checking, that value
      // is simply masked by the two branches above, never displayed.)
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(
        `/api/profile/username-availability?username=${encodeURIComponent(parsedUsername.data)}`,
        { signal: controller.signal },
      )
        .then((res) => res.json())
        .then((data: { available: boolean }) => {
          setCheckResult(data.available ? "available" : "taken");
        })
        .catch(() => {
          // Aborted (superseded by a newer keystroke) or a network hiccup —
          // the next debounce tick resolves it; don't show a false negative.
        });
    }, 400);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parsedUsername/isOwnUsername are pure re-derivations of `username`/`initialUsername` each render; depending on those two primitives directly is equivalent and avoids an unstable object-identity dependency.
  }, [username, initialUsername]);

  const availability: Availability = !parsedUsername.success
    ? username.length > 0
      ? "invalid"
      : "idle"
    : isOwnUsername
      ? "available"
      : checkResult;

  const usernameInvalid =
    Boolean(state.fieldErrors?.username) ||
    availability === "taken" ||
    availability === "invalid";

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormAlert state={state} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          required
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            // Reflects immediately in the same event as the keystroke —
            // not an effect — so there's no "stale for one frame" flash
            // before the debounced check below actually starts.
            setCheckResult("checking");
          }}
          aria-invalid={usernameInvalid}
          aria-describedby="username-status"
        />
        <p
          id="username-status"
          className={cn(
            "text-xs",
            availability === "available" && "text-success",
            (availability === "taken" || availability === "invalid") &&
              "text-destructive",
            (availability === "checking" || availability === "idle") &&
              "text-muted-foreground",
          )}
        >
          {availability === "checking" && "Checking availability…"}
          {availability === "available" && "Available"}
          {availability === "taken" && "That username is already taken."}
          {(availability === "invalid" || availability === "idle") &&
            "3-30 characters: letters, numbers, underscores."}
        </p>
        <FieldError id="username-error" errors={state.fieldErrors?.username} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">
          Display name{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="displayName"
          name="displayName"
          maxLength={80}
          defaultValue={initialDisplayName}
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
          aria-describedby={
            state.fieldErrors?.displayName ? "displayName-error" : undefined
          }
        />
        <FieldError
          id="displayName-error"
          errors={state.fieldErrors?.displayName}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bio">
          Bio{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="bio"
          name="bio"
          rows={3}
          maxLength={500}
          defaultValue={initialBio}
          aria-invalid={Boolean(state.fieldErrors?.bio)}
          aria-describedby={state.fieldErrors?.bio ? "bio-error" : undefined}
        />
        <FieldError id="bio-error" errors={state.fieldErrors?.bio} />
      </div>

      <SubmitButton
        className="w-full"
        pendingText={pendingLabel}
        disabled={availability === "taken" || availability === "checking"}
      >
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
