import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchIcon } from "lucide-react";
import { searchGames } from "@/server/services/game-catalogue";
import { PosterGrid, PosterGridSkeleton } from "@/components/games/poster-grid";
import { IgdbAttribution } from "@/components/games/igdb-attribution";
import { EmptyState } from "@/components/common/empty-state";
import { Heading } from "@/components/common/typography";

export const metadata: Metadata = { title: "Search" };

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = q?.trim();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <Heading level="h3" as="h1" className="mb-6">
        Search
      </Heading>

      {!query ? (
        <EmptyState
          icon={SearchIcon}
          title="Search for a game"
          description='Try a title like "The Legend of Zelda."'
        />
      ) : (
        <Suspense key={query} fallback={<PosterGridSkeleton />}>
          <SearchResults query={query} />
        </Suspense>
      )}

      <IgdbAttribution className="mt-10" />
    </main>
  );
}

async function SearchResults({ query }: { query: string }) {
  const results = await searchGames(query);

  if (results.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="No games found"
        description={`Nothing matched "${query}".`}
      />
    );
  }

  return (
    <PosterGrid
      games={results.map((result) => ({
        slug: result.slug,
        name: result.name,
        coverImageId: result.coverImageId,
        releaseYear: result.releaseYear,
        source: result.source,
      }))}
    />
  );
}
