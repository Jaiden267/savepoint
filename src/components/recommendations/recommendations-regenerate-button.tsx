"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";

function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * Mirrors DiscoverShuffleButton exactly (push, not replace, so Back/
 * Forward steps through prior regenerations), targeting /recommendations
 * instead. Carries forward any existing `?genres=` hint so regenerating
 * while in preference-assisted mode keeps the same genre picks — harmless
 * even once the user has enough signals for full personalization, since
 * getRecommendations ignores hints entirely once past the cold-start
 * threshold.
 */
export function RecommendationsRegenerateButton() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleRegenerate() {
    const params = new URLSearchParams();
    params.set("seed", String(freshSeed()));
    const genres = searchParams.get("genres");
    if (genres) params.set("genres", genres);
    router.push(`/recommendations?${params.toString()}`);
  }

  return (
    <Button type="button" variant="secondary" onClick={handleRegenerate}>
      <Shuffle aria-hidden="true" />
      Regenerate
    </Button>
  );
}
