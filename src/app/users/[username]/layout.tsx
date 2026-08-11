import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getProfileByUsername,
  getProfileStats,
} from "@/server/services/profile";
import { isFollowing } from "@/server/services/follows";
import { avatarUrl } from "@/server/services/avatar";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileNav } from "@/components/profile/profile-nav";

interface Props {
  params: Promise<{ username: string }>;
  children: ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return { title: { template: `%s · @${username}`, default: `@${username}` } };
}

/**
 * Shared header + section nav for every /users/[username]/* page, fetched
 * once here rather than per tab. `notFound()` here renders the segment's
 * own not-found.tsx for every nested route. Renders fully for a signed-out
 * visitor — `viewer` is nullable throughout, never assumed present.
 */
export default async function UserProfileLayout({ params, children }: Props) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const [stats, viewerIsFollowing] = await Promise.all([
    getProfileStats(profile.id),
    isFollowing(viewer?.id ?? null, profile.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12">
      <ProfileHeader
        profile={{
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          bio: profile.bio,
          avatarUrl: avatarUrl(supabase, profile.avatarPath),
          createdAt: profile.createdAt,
        }}
        stats={stats}
        isOwnProfile={viewer?.id === profile.id}
        isSignedIn={Boolean(viewer)}
        isFollowing={viewerIsFollowing}
      />
      <ProfileNav username={profile.username} />
      <div className="mt-6">{children}</div>
    </main>
  );
}
