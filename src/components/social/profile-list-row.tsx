import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/get-initials";
import type { FollowProfileSummary } from "@/server/services/follows";

/** One row in a followers/following list — reused by both /users/[username]/followers and /following. */
export function ProfileListRow({ profile }: { profile: FollowProfileSummary }) {
  return (
    <Link
      href={`/users/${profile.username}`}
      className="border-border focus-visible:ring-ring/50 hover:bg-muted/40 flex items-center gap-3 rounded-lg border p-3 outline-none focus-visible:ring-3"
    >
      <Avatar>
        {profile.avatarUrl ? (
          <AvatarImage src={profile.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback>
          {getInitials(profile.displayName || profile.username)}
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="text-foreground text-sm font-medium">
          {profile.displayName || profile.username}
        </p>
        <p className="text-muted-foreground text-xs">@{profile.username}</p>
      </div>
    </Link>
  );
}
