import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { getProfileByUsername } from "@/server/services/profile";
import { getFollowing } from "@/server/services/follows";
import { ProfileListRow } from "@/components/social/profile-list-row";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";

export const metadata: Metadata = { title: "Following" };

interface Props {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function ProfileFollowingPage({
  params,
  searchParams,
}: Props) {
  const { username } = await params;
  const { page: pageParam } = await searchParams;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const page = parsePage(pageParam);
  const { profiles, hasMore } = await getFollowing({
    userId: profile.id,
    page,
  });

  return (
    <div>
      {profiles.length === 0 ? (
        <EmptyState icon={Users} title="Not following anyone yet" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {profiles.map((followee) => (
              <ProfileListRow key={followee.id} profile={followee} />
            ))}
          </div>
          <nav
            className="mt-8 flex items-center justify-between"
            aria-label="Pagination"
          >
            {page > 1 ? (
              <LinkButton
                variant="secondary"
                size="sm"
                href={`/users/${username}/following?page=${page - 1}`}
              >
                Previous
              </LinkButton>
            ) : (
              <span />
            )}
            {hasMore ? (
              <LinkButton
                variant="secondary"
                size="sm"
                href={`/users/${username}/following?page=${page + 1}`}
              >
                Next
              </LinkButton>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </div>
  );
}
