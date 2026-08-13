import { GRID_CLASSES } from "@/components/games/poster-grid";
import { PosterCard } from "@/components/games/poster-card";
import { CatalogueResultCard } from "@/components/games/catalogue-result-card";
import type { GameSearchResult } from "@/lib/igdb/types";

/**
 * Mixed grid, one item per result in the caller's own rank/selection
 * order — a cached result (`source: "local"`) renders as the normal
 * PosterCard/Link; a catalogue-only result (`source: "igdb"`) renders as
 * the POST-based CatalogueResultCard instead of a GET-triggering Link,
 * since this is exactly the surface docs/PINECONE.md's "on-demand import
 * boundary" section is about. Never two separately-ordered grids — the
 * caller's order is preserved across both card types. Shared by
 * /search's semantic mode and /discover, so both surfaces render cached
 * and catalogue-only games identically rather than duplicating this
 * branch.
 */
export function GameResultGrid({
  results,
  className,
}: {
  results: GameSearchResult[];
  className?: string;
}) {
  return (
    <div className={className ?? GRID_CLASSES}>
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
  );
}
