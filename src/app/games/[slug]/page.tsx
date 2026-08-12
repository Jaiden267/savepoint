import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import {
  getOrImportGameBySlug,
  GameImportRateLimitedError,
} from "@/server/services/game-sync";
import { getGameSocialData } from "@/server/services/game-social";
import { getGameTaggedRefs } from "@/server/services/game-refs";
import { syncGameVector } from "@/lib/pinecone/sync";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import { gameSlugSchema } from "@/lib/validation/games";
import { GameHero } from "@/components/games/game-hero";
import { GameMetadata } from "@/components/games/game-metadata";
import { GameActionPanel } from "@/components/games/game-action-panel";
import { IgdbAttribution } from "@/components/games/igdb-attribution";
import { EmptyState } from "@/components/common/empty-state";
import { Heading } from "@/components/common/typography";
import { ReviewCard } from "@/components/reviews/review-card";
import { OwnReviewCard } from "@/components/reviews/own-review-card";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function GamePage({ params }: Props) {
  const { slug: rawSlug } = await params;
  const parsedSlug = gameSlugSchema.safeParse(rawSlug);
  if (!parsedSlug.success) notFound();

  const clientId = await getClientIdentifier();

  let game;
  try {
    game = await getOrImportGameBySlug(parsedSlug.data, clientId);
  } catch (error) {
    if (error instanceof GameImportRateLimitedError) {
      return (
        <main className="mx-auto w-full max-w-2xl px-4 py-16">
          <EmptyState
            icon={Clock}
            title="Too many requests"
            description="This page is being requested too quickly. Please try again in a moment."
          />
        </main>
      );
    }
    throw error;
  }

  if (!game) notFound();

  // Best-effort, non-blocking: never delays this response and never fails
  // the page if Pinecone is unavailable — syncGameVector never throws and
  // short-circuits instantly for games that are already synced or whose
  // retry budget is exhausted. This route already reads the session below
  // (force-dynamic), so it's a confirmed live request context — after()
  // never fires during `next build`.
  after(() => {
    syncGameVector(game.id).catch(() => {});
  });

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const [{ genres, platforms, gameModes, themes }, social] = await Promise.all([
    getGameTaggedRefs(supabase, game.id),
    getGameSocialData(game.id, game.slug, viewer?.id ?? null),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <GameHero game={game} />
      <div className="mt-8">
        <GameActionPanel
          gameId={game.id}
          gameSlug={game.slug}
          signedIn={Boolean(viewer)}
          userGame={social.userGame}
          existingReview={social.ownReview}
        />
      </div>
      <div className="mt-8">
        <GameMetadata
          game={game}
          genres={genres}
          platforms={platforms}
          gameModes={gameModes}
          themes={themes}
        />
      </div>

      <div className="mt-10">
        <Heading level="h4" as="h2" className="mb-3">
          Rating
        </Heading>
        {social.ratingStats.ratingCount > 0 &&
        social.ratingStats.averageStars !== null ? (
          <p className="text-foreground text-sm">
            {social.ratingStats.averageStars.toFixed(1)}★ from{" "}
            {social.ratingStats.ratingCount} rating
            {social.ratingStats.ratingCount === 1 ? "" : "s"}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">No ratings yet.</p>
        )}
      </div>

      {social.ownReview ? (
        <div className="mt-10">
          <OwnReviewCard ownReview={social.ownReview} />
        </div>
      ) : null}

      {social.recentReviews.length > 0 ? (
        <div className="mt-10">
          <Heading level="h4" as="h2" className="mb-3">
            Recent reviews
          </Heading>
          <div className="flex flex-col gap-3">
            {social.recentReviews.map(
              ({ review, author, likeCount, viewerHasLiked }) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  author={author}
                  likeCount={likeCount}
                  viewerHasLiked={viewerHasLiked}
                  canLike={Boolean(viewer)}
                  variant="compact"
                />
              ),
            )}
          </div>
        </div>
      ) : null}

      <IgdbAttribution className="mt-10" />
    </main>
  );
}
