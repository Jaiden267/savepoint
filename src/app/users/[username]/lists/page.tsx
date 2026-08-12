import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileByUsername } from "@/server/services/profile";
import { getProfileLists } from "@/server/services/lists";
import { ListCard } from "@/components/lists/list-card";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import { Pagination } from "@/components/common/pagination";

export const metadata: Metadata = { title: "Lists" };

interface Props {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function ProfileListsPage({
  params,
  searchParams,
}: Props) {
  const { username } = await params;
  const { page: pageParam } = await searchParams;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwnProfile = viewer?.id === profile.id;

  const page = parsePage(pageParam);
  const { lists, hasMore } = await getProfileLists({
    userId: profile.id,
    viewerId: viewer?.id ?? null,
    page,
  });

  return (
    <div>
      {isOwnProfile ? (
        <div className="mb-4 flex justify-end">
          <LinkButton variant="secondary" size="sm" href="/lists/new">
            New list
          </LinkButton>
        </div>
      ) : null}

      {lists.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No lists yet"
          action={
            isOwnProfile ? (
              <LinkButton href="/lists/new">Create a list</LinkButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {lists.map((list) => (
              <ListCard
                key={list.id}
                id={list.id}
                title={list.title}
                description={list.description}
                isRanked={list.isRanked}
                visibility={list.visibility}
                itemCount={list.itemCount}
              />
            ))}
          </div>
          <Pagination
            page={page}
            hasMore={hasMore}
            makeHref={(p) => `/users/${username}/lists?page=${p}`}
          />
        </>
      )}
    </div>
  );
}
