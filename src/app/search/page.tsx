import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SearchIcon } from "lucide-react";
import { searchGames } from "@/server/services/game-catalogue";
import { searchGamesSemantic } from "@/server/services/semantic-search";
import { createClient } from "@/lib/supabase/server";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import {
  GRID_CLASSES,
  PosterGrid,
  PosterGridSkeleton,
} from "@/components/games/poster-grid";
import { PosterCard } from "@/components/games/poster-card";
import { CatalogueResultCard } from "@/components/games/catalogue-result-card";
import { IgdbAttribution } from "@/components/games/igdb-attribution";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Search" };

type SearchMode = "lexical" | "semantic";

interface Props {
  searchParams: Promise<{ q?: string; mode?: string }>;
}

function modeHref(query: string, mode: SearchMode): string {
  const params = new URLSearchParams({ q: query });
  if (mode === "semantic") params.set("mode", "semantic");
  return `/search?${params.toString()}`;
}

const MODE_TABS: { mode: SearchMode; label: string }[] = [
  { mode: "lexical", label: "Standard" },
  { mode: "semantic", label: "Semantic" },
];

export default async function SearchPage({ searchParams }: Props) {
  const { q, mode: rawMode } = await searchParams;
  const query = q?.trim();
  const mode: SearchMode = rawMode === "semantic" ? "semantic" : "lexical";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageHeader title="Search" />

      {query ? (
        <nav
          aria-label="Search mode"
          className="border-border mb-6 flex gap-1 border-b"
        >
          {MODE_TABS.map((tab) => {
            const isActive = tab.mode === mode;
            return (
              <Link
                key={tab.mode}
                href={modeHref(query, tab.mode)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {!query ? (
        <EmptyState
          icon={SearchIcon}
          title="Search for a game"
          description='Try a title like "The Legend of Zelda," or switch to Semantic and describe what you want to play.'
        />
      ) : (
        <Suspense key={`${query}:${mode}`} fallback={<PosterGridSkeleton />}>
          <SearchResults query={query} mode={mode} />
        </Suspense>
      )}

      <IgdbAttribution className="mt-10" />
    </main>
  );
}

async function SearchResults({
  query,
  mode,
}: {
  query: string;
  mode: SearchMode;
}) {
  let results;
  let showFallbackNotice = false;

  if (mode === "semantic") {
    const supabase = await createClient();
    const clientId = await getClientIdentifier();
    const outcome = await searchGamesSemantic(supabase, { query, clientId });
    results = outcome.results;
    showFallbackNotice = outcome.mode === "lexical_fallback";
  } else {
    results = await searchGames(query);
  }

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
    <>
      {showFallbackNotice ? (
        <p className="text-muted-foreground mb-4 text-sm" role="status">
          Showing standard results — semantic search is temporarily unavailable.
        </p>
      ) : null}
      {mode === "semantic" ? (
        // Mixed grid, one item per Pinecone hit in its own rank order —
        // a cached result (source: "local") renders as the normal
        // PosterCard/Link; a catalogue-only result (source: "igdb", only
        // ever produced by the semantic path — see
        // semantic-search.ts's toCatalogueResult) renders as the
        // POST-based CatalogueResultCard instead of a GET-triggering
        // Link, since this is exactly the surface docs/PINECONE.md's
        // "on-demand import boundary" section is about. Never two
        // separately-ordered grids — Pinecone's combined rank order is
        // preserved across both card types.
        <div className={GRID_CLASSES}>
          {results.map((result) =>
            result.source === "local" ? (
              <PosterCard
                key={`local-${result.slug}`}
                slug={result.slug}
                name={result.name}
                coverImageId={result.coverImageId}
                releaseYear={result.releaseYear}
                source="local"
              />
            ) : (
              <CatalogueResultCard
                key={`igdb-${result.igdbId}`}
                igdbId={result.igdbId}
                name={result.name}
                coverImageId={result.coverImageId}
                releaseYear={result.releaseYear}
              />
            ),
          )}
        </div>
      ) : (
        <PosterGrid
          games={results.map((result) => ({
            slug: result.slug,
            name: result.name,
            coverImageId: result.coverImageId,
            releaseYear: result.releaseYear,
            source: result.source,
          }))}
        />
      )}
    </>
  );
}
