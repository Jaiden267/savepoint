import { StatusSelector } from "@/components/games/status-selector";
import { RatingControl } from "@/components/games/rating-control";
import { LogDiaryEntryDialog } from "@/components/games/log-diary-entry-dialog";
import { ReviewComposer } from "@/components/reviews/review-composer";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import type { LibraryStatus } from "@/lib/validation/library";

interface ExistingReview {
  id: string;
  rating: number;
  body: string;
  hasSpoilers: boolean;
}

interface GameActionPanelProps {
  gameId: string;
  gameSlug: string;
  signedIn: boolean;
  userGame: { status: LibraryStatus; rating: number | null } | null;
  existingReview: ExistingReview | null;
}

/**
 * The authenticated tracking surface on /games/[slug] — status, library
 * rating, a "Log play" diary entry, and the review composer. Signed-out
 * viewers see only a sign-in prompt; the rating control and diary/review
 * entry points don't require a library status first (see the RPC-decision
 * note in docs/SOCIAL.md — only rating itself requires a user_games row).
 */
export function GameActionPanel({
  gameId,
  gameSlug,
  signedIn,
  userGame,
  existingReview,
}: GameActionPanelProps) {
  if (!signedIn) {
    return (
      <EmptyState
        title="Track this game"
        description="Sign in to add it to your library, rate it, log plays, and write a review."
        action={
          <LinkButton href={`/login?next=/games/${gameSlug}`}>
            Sign in
          </LinkButton>
        }
      />
    );
  }

  return (
    <div className="border-border flex flex-col gap-5 rounded-lg border p-4">
      <StatusSelector
        gameId={gameId}
        gameSlug={gameSlug}
        currentStatus={userGame?.status ?? null}
      />
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={userGame?.rating ?? null}
        inLibrary={userGame != null}
      />
      <div className="flex flex-wrap gap-2">
        <LogDiaryEntryDialog
          gameId={gameId}
          gameSlug={gameSlug}
          triggerLabel="Log play"
        />
        <ReviewComposer
          gameId={gameId}
          gameSlug={gameSlug}
          existingReview={existingReview}
        />
      </div>
    </div>
  );
}
