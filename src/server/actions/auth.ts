"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import { isSafeRedirectPath } from "@/lib/auth/redirect-safety";
import type { ActionState } from "@/lib/action-state";

/**
 * Maps common Supabase Auth error strings to calm, non-technical copy.
 * Never surface a raw Supabase error to the user — messages can change
 * between SDK versions and sometimes describe internals a user shouldn't
 * see.
 */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "That email and password don't match. Double-check and try again.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email before signing in — check your inbox for the confirmation link.";
  }
  if (lower.includes("already registered")) {
    return "An account with that email already exists. Try signing in instead.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (lower.includes("password")) {
    return "Please choose a different password and try again.";
  }
  return "Something went wrong. Please try again.";
}

async function currentUserProfileDestination(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();
  return profile?.username ? `/users/${profile.username}` : "/";
}

export async function signUpAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identifier = await getClientIdentifier();
  const rate = checkRateLimit(`signup:${identifier}`, {
    limit: 5,
    windowSeconds: 15 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  }

  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
    },
  });

  if (error) {
    return { status: "error", message: friendlyAuthError(error.message) };
  }

  return {
    status: "success",
    message:
      "Check your inbox to confirm your email and finish creating your account.",
  };
}

export async function signInAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identifier = await getClientIdentifier();
  const rate = checkRateLimit(`signin:${identifier}`, {
    limit: 10,
    windowSeconds: 15 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  }

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { status: "error", message: friendlyAuthError(error.message) };
  }

  const rawNext = formData.get("next");
  const next = typeof rawNext === "string" ? rawNext : null;
  if (isSafeRedirectPath(next)) {
    redirect(next);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? await currentUserProfileDestination(supabase, user.id) : "/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function forgotPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identifier = await getClientIdentifier();
  const rate = checkRateLimit(`forgot-password:${identifier}`, {
    limit: 5,
    windowSeconds: 15 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  }

  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid email address.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  // Result (including any error) is deliberately ignored: whether or not an
  // account exists for this email, the response to the user must be
  // identical — see the SECURITY requirement in docs/AUTH.md. Never branch
  // user-visible behavior on this call's outcome.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });

  return {
    status: "success",
    message:
      "If an account exists for that email, we've sent a link to reset your password.",
  };
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();

  // Requires an active (recovery) session. The proxy route policy already
  // keeps an unauthenticated visitor from reaching this page, but a Server
  // Action must never trust that it was only ever invoked from the
  // "correct" UI path — re-check here too.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      status: "error",
      message: "Your reset link has expired. Request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { status: "error", message: friendlyAuthError(error.message) };
  }

  redirect(await currentUserProfileDestination(supabase, user.id));
}
