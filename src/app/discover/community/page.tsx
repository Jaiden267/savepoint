import type { Metadata } from "next";
import { Suspense } from "react";
import { Search, ListChecks, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  searchProfiles,
  getRecentPublicReviews,
} from "@/server/services/discovery";
import { getPopularPublicLists } from "@/server/services/lists";
import { searchQuerySchema } from "@/lib/validation/games";
import { ProfileListRow } from "@/components/social/profile-list-row";
import { ListCard } from "@/components/lists/list-card";
import { ReviewCard } from "@/components/reviews/review-card";
import { EmptyState } from "@/components/common/empty-state";
import { Heading } from "@/components/common/typography";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Community" };

interface Props {
  searchParams: Promise<{ q?: string }>;
}

/**
 * Social discovery — user search, popular public lists, recent public
 * reviews. Kept separate from the existing /discover (Prompt 3's game
 * catalogue browse page) to avoid touching that already-tested page. Each
 * section is its own async Server Component behind <Suspense>, so a slow
 * section never blocks the others from streaming in.
 */
export default async function CommunityDiscoveryPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const parsedQuery = q ? searchQuerySchema.safeParse(q) : null;
  const query = parsedQuery?.success ? parsedQuery.data : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Heading level="h3" as="h1" className="mb-6">
        Community
      </Heading>

      <section>
        <Heading level="h4" as="h2">
          Find people
        </Heading>
        <form method="get" className="mt-3">
          <label htmlFor="q" className="sr-only">
            Search by username or display name
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            placeholder="Search by username or display name"
            defaultValue={query ?? ""}
          />
        </form>
        {query ? (
          <div className="mt-4">
            <Suspense fallback={<RowsSkeleton count={3} height="h-16" />}>
              <UserSearchResults query={query} />
            </Suspense>
          </div>
        ) : null}
      </section>

      <section className="mt-10">
        <Heading level="h4" as="h2">
          Popular public lists
        </Heading>
        <div className="mt-4">
          <Suspense fallback={<GridSkeleton count={4} />}>
            <PopularLists />
          </Suspense>
        </div>
      </section>

      <section className="mt-10">
        <Heading level="h4" as="h2">
          Recent reviews
        </Heading>
        <div className="mt-4">
          <Suspense fallback={<RowsSkeleton count={3} height="h-32" />}>
            <RecentReviews />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function UserSearchResults({ query }: { query: string }) {
  const { profiles } = await searchProfiles({ query, page: 1 });
  if (profiles.length === 0) {
    return <EmptyState icon={Search} title="No users found" />;
  }
  return (
    <div className="flex flex-col gap-2">
      {profiles.map((profile) => (
        <ProfileListRow key={profile.id} profile={profile} />
      ))}
    </div>
  );
}

async function PopularLists() {
  const { lists } = await getPopularPublicLists({ page: 1 });
  if (lists.length === 0) {
    return <EmptyState icon={ListChecks} title="No public lists yet" />;
  }
  return (
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
          author={list.author}
        />
      ))}
    </div>
  );
}

async function RecentReviews() {
  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const { reviews } = await getRecentPublicReviews({
    page: 1,
    viewerId: viewer?.id ?? null,
  });
  if (reviews.length === 0) {
    return <EmptyState icon={MessageSquare} title="No reviews yet" />;
  }
  return (
    <div className="flex flex-col gap-3">
      {reviews.map(({ review, author, likeCount, viewerHasLiked }) => (
        <ReviewCard
          key={review.id}
          review={review}
          author={author}
          likeCount={likeCount}
          viewerHasLiked={viewerHasLiked}
          canLike={Boolean(viewer)}
          variant="full"
        />
      ))}
    </div>
  );
}

function RowsSkeleton({ count, height }: { count: number; height: string }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={`${height} w-full rounded-lg`} />
      ))}
    </div>
  );
}

function GridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}
