"use client";

import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Narrow client component — no data fetching, no sampling logic. Just
 * generates one fresh 32-bit seed and navigates to `/discover?seed=...`,
 * which re-runs the Server Component with that seed baked into the URL.
 * `router.push` (not `replace`) deliberately: each shuffle adds a browser
 * history entry, so Back/Forward steps through previous selections
 * instead of skipping them — the same seed always reproduces the same
 * selection (see discover-catalogue.ts), so this is enough on its own
 * for correct, stable browser navigation without any client-side
 * randomness ever touching the rendered grid.
 */
export function DiscoverShuffleButton() {
  const router = useRouter();

  function handleShuffle() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    router.push(`/discover?seed=${seed}`);
  }

  return (
    <Button type="button" variant="secondary" onClick={handleShuffle}>
      <Shuffle aria-hidden="true" />
      Shuffle games
    </Button>
  );
}
