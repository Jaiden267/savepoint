"use client";

import { useEffect, useRef } from "react";
import { recordRecommendationImpressionsAction } from "@/server/actions/recommendations";

/**
 * Fires exactly once, after the recommendation grid has actually
 * committed to the DOM client-side — never from a server-side data fetch
 * (which would count prefetches/aborted renders as impressions; see
 * docs/RECOMMENDATIONS.md). The `useRef` guard is specifically against
 * React Strict Mode's intentional dev double-invoke of effects, not a
 * substitute for the server-side idempotency window
 * recordRecommendationImpressionsAction itself enforces. Renders nothing —
 * a fresh instance per seed (via the page's `<Suspense key={seed}>`, the
 * same pattern /discover uses) is what makes "fires once per real render"
 * correct here rather than needing to track seed changes itself.
 */
export function RecommendationImpressionTracker({
  igdbIds,
}: {
  igdbIds: number[];
}) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (igdbIds.length === 0) return;
    void recordRecommendationImpressionsAction(igdbIds).catch(() => {});
  }, [igdbIds]);

  return null;
}
