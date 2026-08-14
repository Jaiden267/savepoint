"use client";

import { useCallback } from "react";
import { PosterCard } from "@/components/games/poster-card";
import { CatalogueResultCard } from "@/components/games/catalogue-result-card";
import { importRecommendedCatalogueGameAction } from "@/server/actions/recommendations";
import { RecommendationFeedbackButtons } from "./recommendation-feedback-buttons";
import type { RecommendationResult } from "@/server/services/recommendations";

const CLICK_BEACON_URL = "/api/recommendations/click";

/**
 * Fires the click-tracking beacon without preventing default navigation —
 * see docs/RECOMMENDATIONS.md's click-tracking design. `sendBeacon`'s
 * return value is always checked: `false` means the browser rejected
 * queuing it (payload/queue limits), not that it silently failed, so that
 * case falls back to `fetch(..., {keepalive:true})` immediately, same as
 * when `sendBeacon` doesn't exist at all. Never throws — a telemetry
 * failure must never block navigation.
 */
function sendClickBeacon(igdbId: number) {
  try {
    const body = new Blob([JSON.stringify({ igdbId })], {
      type: "application/json",
    });
    if (typeof navigator.sendBeacon === "function") {
      const queued = navigator.sendBeacon(CLICK_BEACON_URL, body);
      if (queued) return;
    }
    void fetch(CLICK_BEACON_URL, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never block navigation.
  }
}

/**
 * Composes the existing PosterCard/CatalogueResultCard (untouched, poster
 * markup only) with a sibling reason caption + feedback buttons footer —
 * never injected into either shared component's own single-interactive-
 * element wrapper (a `<Link>` and a `<form>`/`<button>` respectively).
 * Cached results are click-tracked via a beacon (plain onClick/onAuxClick,
 * no preventDefault, so keyboard/modified-click/middle-click navigation
 * all keep working exactly as PosterCard already implements them);
 * catalogue-only results are tracked server-side, inside
 * importRecommendedCatalogueGameAction's own request, via the `action`
 * prop CatalogueResultCard now accepts.
 */
export function RecommendationCard({
  result,
}: {
  result: RecommendationResult;
}) {
  const handleClick = useCallback(() => {
    sendClickBeacon(result.igdbId);
  }, [result.igdbId]);

  return (
    <div className="flex flex-col gap-2">
      {result.source === "local" ? (
        <div onClick={handleClick} onAuxClick={handleClick}>
          <PosterCard
            slug={result.slug}
            name={result.name}
            coverImageId={result.coverImageId}
            releaseYear={result.releaseYear}
            source="local"
          />
        </div>
      ) : (
        <CatalogueResultCard
          igdbId={result.igdbId}
          name={result.name}
          coverImageId={result.coverImageId}
          releaseYear={result.releaseYear}
          action={importRecommendedCatalogueGameAction}
        />
      )}
      <p className="text-muted-foreground text-xs">{result.reason}</p>
      <RecommendationFeedbackButtons igdbId={result.igdbId} />
    </div>
  );
}
