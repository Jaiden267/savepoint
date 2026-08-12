"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Heart, Lock } from "lucide-react";
import { toggleReviewLikeAction } from "@/server/actions/reviews";
import { starGlyphs } from "@/lib/rating";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/get-initials";
import { cn } from "@/lib/utils";

export interface ReviewCardData {
  id: string;
  rating: number;
  body: string;
  hasSpoilers: boolean;
  createdAt: string;
  gameSlug: string;
}

export interface ReviewCardAuthor {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ReviewCardProps {
  review: ReviewCardData;
  author: ReviewCardAuthor;
  likeCount: number;
  viewerHasLiked: boolean;
  /** Signed-in viewers can like/unlike; signed-out viewers see a read-only count. */
  canLike: boolean;
  /** The review's own author sees their content unfiltered, no reveal click required. */
  isOwnReview?: boolean;
  variant?: "compact" | "full";
  className?: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Renders review/comment text as plain text via whitespace-pre-wrap —
 * React's default text-node escaping plus CSS line-break preservation, zero
 * HTML parsing. Never dangerouslySetInnerHTML for user-generated content
 * (see CLAUDE.md).
 */
export function ReviewCard({
  review,
  author,
  likeCount,
  viewerHasLiked,
  canLike,
  isOwnReview = false,
  variant = "compact",
  className,
}: ReviewCardProps) {
  const [revealed, setRevealed] = useState(false);
  const bodyId = useId();
  const [isPending, startTransition] = useTransition();
  const [optimisticLike, setOptimisticLike] = useOptimistic({
    liked: viewerHasLiked,
    count: likeCount,
  });

  function handleToggleLike() {
    const nextLiked = !optimisticLike.liked;
    const nextCount = optimisticLike.count + (nextLiked ? 1 : -1);
    startTransition(async () => {
      setOptimisticLike({ liked: nextLiked, count: nextCount });
      const result = await toggleReviewLikeAction(
        review.id,
        nextLiked,
        review.gameSlug,
      );
      if (result.status === "error") {
        setOptimisticLike({ liked: viewerHasLiked, count: likeCount });
      }
    });
  }

  const showSpoilerGate = review.hasSpoilers && !revealed && !isOwnReview;

  return (
    <article className={cn("border-border rounded-lg border p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/users/${author.username}`}
          className="focus-visible:ring-ring/50 flex items-center gap-2 rounded-md outline-none focus-visible:ring-3"
        >
          <Avatar size="sm">
            {author.avatarUrl ? (
              <AvatarImage src={author.avatarUrl} alt="" />
            ) : null}
            <AvatarFallback>
              {getInitials(author.displayName || author.username)}
            </AvatarFallback>
          </Avatar>
          <span className="text-foreground text-sm font-medium">
            {author.displayName || author.username}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <span
            className="text-muted-foreground text-xs"
            aria-label={`${review.rating} out of 5 stars`}
          >
            {starGlyphs(review.rating)}
          </span>
          {variant === "compact" ? (
            <Link
              href={`/reviews/${review.id}`}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              {formatDate(review.createdAt)}
            </Link>
          ) : (
            <span className="text-muted-foreground text-xs">
              {formatDate(review.createdAt)}
            </span>
          )}
        </div>
      </div>

      {review.hasSpoilers ? (
        <Badge variant="outline" className="mt-2">
          Contains spoilers
        </Badge>
      ) : null}

      <div className="mt-2" aria-live="polite">
        {showSpoilerGate ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={false}
            aria-controls={bodyId}
            onClick={() => setRevealed(true)}
          >
            <Lock aria-hidden="true" />
            Contains spoilers — click to reveal
          </Button>
        ) : (
          <p
            id={bodyId}
            className="text-foreground text-sm whitespace-pre-wrap"
          >
            {review.body}
          </p>
        )}
      </div>

      {canLike ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3"
          disabled={isPending}
          aria-pressed={optimisticLike.liked}
          onClick={handleToggleLike}
        >
          <Heart
            aria-hidden="true"
            className={cn(
              optimisticLike.liked && "text-destructive fill-current",
            )}
          />
          {optimisticLike.count}
        </Button>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">
          {optimisticLike.count} like{optimisticLike.count === 1 ? "" : "s"}
        </p>
      )}
    </article>
  );
}
