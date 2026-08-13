import { SearchIcon } from "lucide-react";
import { searchGames } from "@/server/services/game-catalogue";
import { searchGamesSemantic } from "@/server/services/semantic-search";
import { createClient } from "@/lib/supabase/server";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import { PosterGrid } from "@/components/games/poster-grid";
import { GameResultGrid } from "@/components/games/game-result-grid";
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
        // Pinecone's own rank order is preserved as-is — never re-ranked
        // the way lexical results are, and never split into two
        // separately-ordered grids.
        <GameResultGrid results={results} />
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
