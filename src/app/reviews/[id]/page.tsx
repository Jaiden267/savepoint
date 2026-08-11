import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReviewDetail } from "@/server/services/reviews";
import { uuidSchema } from "@/lib/validation/common";
import { ReviewCard } from "@/components/reviews/review-card";
import { CommentItem } from "@/components/reviews/comment-item";
import { CommentComposer } from "@/components/reviews/comment-composer";
import { LinkButton } from "@/components/common/link-button";
import { Heading } from "@/components/common/typography";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Review" };
}

export default async function ReviewDetailPage({ params }: Props) {
  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const detail = await getReviewDetail(parsedId.data, viewer?.id ?? null);
  if (!detail) notFound();

  const { review, author, likeCount, viewerHasLiked, isOwnReview, comments } =
    detail;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <ReviewCard
        review={review}
        author={author}
        likeCount={likeCount}
        viewerHasLiked={viewerHasLiked}
        canLike={Boolean(viewer)}
        isOwnReview={isOwnReview}
        variant="full"
      />

      {isOwnReview ? (
        <div className="mt-3">
          <LinkButton
            variant="ghost"
            size="sm"
            href={`/games/${review.gameSlug}`}
          >
            Edit on game page
          </LinkButton>
        </div>
      ) : null}

      <div className="mt-10">
        <Heading level="h4" as="h2" className="mb-4">
          Comments
        </Heading>

        {viewer ? (
          <div className="mb-4">
            <CommentComposer reviewId={review.id} />
          </div>
        ) : (
          <p className="text-muted-foreground mb-4 text-sm">
            <LinkButton
              variant="ghost"
              size="sm"
              href={`/login?next=/reviews/${review.id}`}
            >
              Sign in
            </LinkButton>{" "}
            to comment.
          </p>
        )}

        {comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No comments yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                author={comment.author}
                reviewId={review.id}
                isOwner={comment.isOwner}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
