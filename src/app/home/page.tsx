import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getHomeFeed } from "@/server/services/activity-feed";
import { FeedItemCard } from "@/components/activity/feed-item";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Home" };

interface Props {
  searchParams: Promise<{ cursor?: string }>;
}

export default async function HomePage({ searchParams }: Props) {
  const { cursor } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive — the proxy route policy already guards this page.
  if (!user) redirect("/login?next=/home");

  const { items, hasMore, nextCursor } = await getHomeFeed({
    viewerId: user.id,
    cursor: cursor ?? null,
  });

  const isFirstPage = !cursor;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <PageHeader title="Home" />

      {items.length === 0 && isFirstPage ? (
        <EmptyState
          icon={Users}
          title="Your feed is empty"
          description="Follow other users to see their reviews, ratings, diary logs, and lists here."
          action={
            <LinkButton href="/discover/community">
              Find people to follow
            </LinkButton>
          }
        />
      ) : (
        <>
          {items.length > 0 ? (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <FeedItemCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center text-sm">
              Nothing on this page — there may be more further back.
            </p>
          )}

          {hasMore && nextCursor ? (
            <div className="mt-8 flex justify-center">
              <LinkButton
                variant="secondary"
                href={`/home?cursor=${encodeURIComponent(nextCursor)}`}
              >
                Load more
              </LinkButton>
            </div>
          ) : items.length > 0 ? (
            <p className="text-muted-foreground mt-8 text-center text-sm">
              You&apos;re all caught up.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
