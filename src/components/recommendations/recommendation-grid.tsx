import { RecommendationCard } from "./recommendation-card";
import { RecommendationImpressionTracker } from "./recommendation-impression-tracker";
import type { RecommendationResult } from "@/server/services/recommendations";
import { GRID_CLASSES } from "@/components/games/poster-grid";

/**
 * Mirrors GameResultGrid's shape (one item per result, caller's own
 * rank/selection order preserved, cached vs. catalogue-only branch), plus
 * the reason caption + feedback buttons a plain GameSearchResult grid
 * doesn't need — a new, small component rather than adding an optional
 * reason/feedback prop to the shared GameResultGrid/PosterCard, since a
 * reason+feedback footer has to render as external sibling markup
 * regardless (see RecommendationCard's own doc comment).
 */
export function RecommendationGrid({
  results,
}: {
  results: RecommendationResult[];
}) {
  return (
    <>
      <RecommendationImpressionTracker
        igdbIds={results.map((result) => result.igdbId)}
      />
      <div className={GRID_CLASSES}>
        {results.map((result) => (
          <RecommendationCard
            key={`${result.source}-${result.igdbId}`}
            result={result}
          />
        ))}
      </div>
    </>
  );
}
