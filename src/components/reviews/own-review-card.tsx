import { Badge } from "@/components/ui/badge";
import { starGlyphs } from "@/lib/rating";
import type { OwnReviewSummary } from "@/server/services/game-social";

/**
 * The authenticated owner's own review, shown as its own clearly-labeled
 * block on their game page — separate from "Recent reviews," which
 * deliberately excludes it (see game-social.ts's `.neq("user_id",
 * viewerId)`) to avoid showing it twice. Renders nothing when there is no
 * review yet. Body renders as plain text via whitespace-pre-wrap — never
 * dangerouslySetInnerHTML (see CLAUDE.md) — matching review-card.tsx.
 */
export function OwnReviewCard({
  ownReview,
}: {
  ownReview: OwnReviewSummary | null;
}) {
  if (!ownReview) return null;

  return (
    <div className="border-border rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground text-sm font-medium">Your review</span>
        <span
          className="text-muted-foreground text-xs"
          aria-label={`${ownReview.rating} out of 5 stars`}
        >
          {starGlyphs(ownReview.rating)}
        </span>
      </div>

      {ownReview.hasSpoilers ? (
        <Badge variant="outline" className="mt-2">
          Contains spoilers
        </Badge>
      ) : null}

      <p className="text-foreground mt-2 text-sm whitespace-pre-wrap">
        {ownReview.body}
      </p>
    </div>
  );
}
