import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LinkButton } from "@/components/common/link-button";
import { Heading, Text } from "@/components/common/typography";
import { FollowButton } from "@/components/social/follow-button";
import { getInitials } from "@/lib/get-initials";

export interface ProfileHeaderProps {
  profile: {
    id: string;
    username: string;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    createdAt: string;
  };
  stats: {
    gamesCompleted: number;
    reviewCount: number;
    listCount: number;
    followerCount: number;
    followingCount: number;
  };
  isOwnProfile: boolean;
  isSignedIn: boolean;
  isFollowing: boolean;
}

/** Shared header for every /users/[username]/* page — avatar, name, bio, follow control, stats grid. Rendered once by the segment layout.tsx. */
export function ProfileHeader({
  profile,
  stats,
  isOwnProfile,
  isSignedIn,
  isFollowing,
}: ProfileHeaderProps) {
  const joined = new Date(profile.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });

  return (
    <div>
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
        <Avatar className="size-20 shrink-0" size="lg">
          {profile.avatarUrl ? (
            <AvatarImage src={profile.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback className="text-xl">
            {getInitials(profile.displayName || profile.username)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <Heading level="h3" as="h1">
            {profile.displayName || profile.username}
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
        ) : isSignedIn ? (
          <FollowButton
            targetUserId={profile.id}
            targetUsername={profile.username}
            initialFollowing={isFollowing}
          />
        ) : (
          <LinkButton
            variant="secondary"
            href={`/login?next=${encodeURIComponent(`/users/${profile.username}`)}`}
          >
            Sign in to follow
          </LinkButton>
        )}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Completed" value={stats.gamesCompleted} />
        <StatTile label="Reviews" value={stats.reviewCount} />
        <StatTile label="Lists" value={stats.listCount} />
        <StatLink
          label="Followers"
          value={stats.followerCount}
          href={`/users/${profile.username}/followers`}
        />
        <StatLink
          label="Following"
          value={stats.followingCount}
          href={`/users/${profile.username}/following`}
        />
      </div>
    </div>
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

function StatLink({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="border-border focus-visible:ring-ring/50 hover:bg-muted/40 rounded-lg border p-4 text-center outline-none focus-visible:ring-3"
    >
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </Link>
  );
}
