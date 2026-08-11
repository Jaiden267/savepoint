import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateProfileAction } from "@/server/actions/profile";
import { Heading } from "@/components/common/typography";
import { ProfileForm } from "@/components/profile/profile-form";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { getInitials } from "@/lib/get-initials";

export const metadata: Metadata = { title: "Profile settings" };

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive — the proxy route policy already guards this page.
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, bio, avatar_path")
    .eq("id", user.id)
    .maybeSingle();

  // Every authenticated user has a profile (auto-created on signup); if
  // this ever comes back empty, onboarding hasn't run yet.
  if (!profile) redirect("/onboarding");

  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data
        .publicUrl
    : null;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-12">
      <Heading level="h3" as="h1" className="mb-6">
        Profile settings
      </Heading>

      <section className="mb-8">
        <AvatarUploader
          avatarUrl={avatarUrl}
          initials={getInitials(profile.display_name || profile.username)}
        />
      </section>

      <ProfileForm
        action={updateProfileAction}
        initialUsername={profile.username}
        initialDisplayName={profile.display_name ?? ""}
        initialBio={profile.bio ?? ""}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </main>
  );
}
