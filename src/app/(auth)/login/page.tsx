import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { FormAlert } from "@/components/common/form-alert";
import { isSafeRedirectPath } from "@/lib/auth/redirect-safety";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid:
    "That link is invalid or has expired. Please sign in, or request a new link.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = isSafeRedirectPath(params.next) ? params.next : undefined;
  const errorMessage = params.error
    ? (ERROR_MESSAGES[params.error] ??
      "Something went wrong. Please try again.")
    : undefined;

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your Savepoint account."
    >
      {errorMessage ? (
        <FormAlert state={{ status: "error", message: errorMessage }} />
      ) : null}
      <LoginForm next={next} />
    </AuthCard>
  );
}
