import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { listDiscoverGames } from "@/server/services/game-catalogue";
import { PosterGrid } from "@/components/games/poster-grid";
import { IgdbAttribution } from "@/components/games/igdb-attribution";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";

export const metadata: Metadata = {
  title: "Discover",
};

interface Props {
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function DiscoverPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const { games, hasMore } = await listDiscoverGames({ page });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageHeader title="Discover" />

      {games.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No games yet"
          description="Search for a game to start building the catalogue."
          action={<LinkButton href="/search">Search games</LinkButton>}
        />
      ) : (
        <>
          <PosterGrid
            games={games.map((game) => ({
              slug: game.slug,
              name: game.name,
              coverImageId: game.cover_image_id,
              releaseYear: game.release_date
                ? new Date(game.release_date).getUTCFullYear()
                : null,
              source: "local" as const,
            }))}
          />
          <Pagination
            page={page}
            hasMore={hasMore}
            makeHref={(p) => `/discover?page=${p}`}
          />
        </>
      )}

      <IgdbAttribution className="mt-10" />
    </main>
  );
}
