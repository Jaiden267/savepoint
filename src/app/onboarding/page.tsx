import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { completeOnboardingAction } from "@/server/actions/profile";
import { Heading, Text } from "@/components/common/typography";
import { ProfileForm } from "@/components/profile/profile-form";

export const metadata: Metadata = { title: "Set up your profile" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive — the proxy route policy already guards this page.
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, bio")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Heading level="h2" as="h1">
            Welcome to Savepoint
          </Heading>
          <Text tone="muted" className="mt-2">
            Pick a username to finish setting up your account.
          </Text>
        </div>
        <ProfileForm
          action={completeOnboardingAction}
          initialUsername={profile?.username ?? ""}
          initialDisplayName={profile?.display_name ?? ""}
          initialBio={profile?.bio ?? ""}
          submitLabel="Continue"
          pendingLabel="Saving…"
        />
      </div>
    </main>
  );
}
