import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Choose a new password"
      description="You're almost done — set a new password for your account."
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
