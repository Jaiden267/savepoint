import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LinkButton } from "@/components/common/link-button";
import { Heading, Text } from "@/components/common/typography";
import { getInitials } from "@/lib/get-initials";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return { title: username };
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_path, created_at")
    .eq("username", username)
    .maybeSingle();

  if (!profile) notFound();

  const { data: stats } = await supabase
    .from("profile_stats")
    .select(
      "games_completed, review_count, list_count, follower_count, following_count",
    )
    .eq("user_id", profile.id)
    .maybeSingle();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwnProfile = viewer?.id === profile.id;

  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data
        .publicUrl
    : null;

  const joined = new Date(profile.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
        <Avatar className="size-20 shrink-0" size="lg">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-xl">
            {getInitials(profile.display_name || profile.username)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <Heading level="h3" as="h1">
            {profile.display_name || profile.username}
          </Heading>
          <Text tone="muted" size="sm">
            @{profile.username}
          </Text>
          {profile.bio ? (
            <Text className="mt-3 text-pretty">{profile.bio}</Text>
          ) : null}
          <Text tone="muted" size="sm" className="mt-3">
            Joined {joined}
          </Text>
        </div>

        {isOwnProfile ? (
          <LinkButton variant="secondary" href="/settings/profile">
            Edit profile
          </LinkButton>
        ) : null}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Completed" value={stats?.games_completed ?? 0} />
        <StatTile label="Reviews" value={stats?.review_count ?? 0} />
        <StatTile label="Followers" value={stats?.follower_count ?? 0} />
        <StatTile label="Following" value={stats?.following_count ?? 0} />
      </div>

      <p className="text-muted-foreground mt-10 text-center text-sm">
        Diary, ratings, reviews and lists arrive in later milestones.
      </p>
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border rounded-lg border p-4 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}
