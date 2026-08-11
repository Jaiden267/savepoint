import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Track, rate and discover the games you play."
    >
      <SignupForm />
    </AuthCard>
  );
}
