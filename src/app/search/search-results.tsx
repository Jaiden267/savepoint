import { SearchIcon } from "lucide-react";
import { searchGames } from "@/server/services/game-catalogue";
import { searchGamesSemantic } from "@/server/services/semantic-search";
import { createClient } from "@/lib/supabase/server";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import { GRID_CLASSES, PosterGrid } from "@/components/games/poster-grid";
import { PosterCard } from "@/components/games/poster-card";
import { CatalogueResultCard } from "@/components/games/catalogue-result-card";
import { EmptyState } from "@/components/common/empty-state";
import type { SearchMode } from "./search-mode";

/**
 * Not a route file (no export restrictions the way page.tsx has under
 * Next's generated route typegen) — split out specifically so this async
 * Server Component can be awaited directly in tests, the same way
 * games/[slug]/page.test.tsx awaits the whole page eagerly rather than
 * relying on <Suspense> to resolve async children in-test (plain
 * @testing-library/react `render()` has no RSC-aware microtask flush for
 * a Suspense-nested async component in this project's jsdom setup).
 */
export async function SearchResults({
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
