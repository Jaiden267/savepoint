import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileByUsername } from "@/server/services/profile";
import { listUserReviews } from "@/server/services/reviews";
import { ReviewCard } from "@/components/reviews/review-card";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";

export const metadata: Metadata = { title: "Reviews" };

interface Props {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function ProfileReviewsPage({
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

  const page = parsePage(pageParam);
  const { reviews, hasMore } = await listUserReviews({
    userId: profile.id,
    viewerId: viewer?.id ?? null,
    page,
  });

  return (
    <div>
      {reviews.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No reviews yet" />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {reviews.map(({ review, author, likeCount, viewerHasLiked }) => (
              <ReviewCard
                key={review.id}
                review={review}
                author={author}
                likeCount={likeCount}
                viewerHasLiked={viewerHasLiked}
                canLike={Boolean(viewer)}
                isOwnReview={viewer?.id === profile.id}
                variant="full"
              />
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
                href={`/users/${username}/reviews?page=${page - 1}`}
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
                href={`/users/${username}/reviews?page=${page + 1}`}
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
