import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import {
  getOrImportGameBySlug,
  GameImportRateLimitedError,
} from "@/server/services/game-sync";
import { getGameSocialData } from "@/server/services/game-social";
import { createClient } from "@/lib/supabase/server";
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

interface NamedRef {
  id: number;
  name: string;
  slug: string;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

/** Resolves a game's tagged reference rows (genres/platforms/modes/themes) via the join table, in two safe steps rather than relying on nested-embed type inference against the hand-patched types.ts. */
async function fetchTaggedRefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  joinTable:
    "game_genres" | "game_platforms" | "game_game_modes" | "game_themes",
  joinColumn: "genre_id" | "platform_id" | "game_mode_id" | "theme_id",
  refTable: "genres" | "platforms" | "game_modes" | "themes",
  gameId: string,
): Promise<NamedRef[]> {
  const { data: links } = await supabase
    .from(joinTable)
    .select("*")
    .eq("game_id", gameId);

  const ids = (links ?? [])
    .map((link) => (link as unknown as Record<string, number>)[joinColumn])
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0) return [];

  const { data: refs } = await supabase
    .from(refTable)
    .select("id, name, slug")
    .in("id", ids);
  return refs ?? [];
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

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const [genres, platforms, gameModes, themes, social] = await Promise.all([
    fetchTaggedRefs(supabase, "game_genres", "genre_id", "genres", game.id),
    fetchTaggedRefs(
      supabase,
      "game_platforms",
      "platform_id",
      "platforms",
      game.id,
    ),
    fetchTaggedRefs(
      supabase,
      "game_game_modes",
      "game_mode_id",
      "game_modes",
      game.id,
    ),
    fetchTaggedRefs(supabase, "game_themes", "theme_id", "themes", game.id),
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
