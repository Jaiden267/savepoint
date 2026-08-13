import { Clock, Compass } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import {
  listDiscoverCatalogue,
  DiscoverCatalogueUnavailableError,
  DiscoverRateLimitedError,
} from "@/server/services/discover-catalogue";
import { listDiscoverGames } from "@/server/services/game-catalogue";
import { GameResultGrid } from "@/components/games/game-result-grid";
import { PosterGrid } from "@/components/games/poster-grid";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import { PineconeIndexUnavailableError } from "@/lib/pinecone/client";
import type { GameSearchResult } from "@/lib/igdb/types";

type DiscoverState =
  | { kind: "success"; results: GameSearchResult[]; reduced: boolean }
  | { kind: "rate-limited" }
  | { kind: "fallback" };

/** No JSX here — only data resolution, so the try/catch below stays a plain data-fetch (JSX construction inside try/catch doesn't actually get caught by it, since React defers rendering; see the react-hooks/error-boundaries lint rule). */
async function resolveDiscoverState(seed: number): Promise<DiscoverState> {
  const supabase = await createClient();
  const clientId = await getClientIdentifier();

  try {
    const { results, reduced } = await listDiscoverCatalogue(supabase, {
      seed,
      clientId,
    });
    return { kind: "success", results, reduced };
  } catch (err) {
    if (err instanceof DiscoverRateLimitedError) {
      return { kind: "rate-limited" };
    }
    if (
      err instanceof DiscoverCatalogueUnavailableError ||
      err instanceof PineconeIndexUnavailableError
    ) {
      return { kind: "fallback" };
    }
    throw err;
  }
}

/**
 * Not a route file — split out for direct testability the same way
 * search-results.tsx is (see that file's comment). Tries the full
 * synced-catalogue sample first; a rate limit renders a friendly retry
 * state; a genuine ledger/Pinecone unavailability (never a merely-reduced
 * count — see discover-catalogue.ts) falls back to the smaller,
 * already-cached `games` listing rather than a hard error.
 */
export async function DiscoverResults({ seed }: { seed: number }) {
  const state = await resolveDiscoverState(seed);

  if (state.kind === "rate-limited") {
    return (
      <EmptyState
        icon={Clock}
        title="Too many requests"
        description="You're browsing quickly — try again in a few seconds."
      />
    );
  }

  if (state.kind === "fallback") {
    return await renderCachedFallback();
  }

  return (
    <>
      {state.reduced ? (
        <p className="text-muted-foreground mb-4 text-sm" role="status">
          Showing fewer games than usual right now.
        </p>
      ) : null}
      <GameResultGrid results={state.results} />
    </>
  );
}

async function renderCachedFallback() {
  const { games } = await listDiscoverGames({ page: 1 });

  if (games.length === 0) {
    return (
      <EmptyState
        icon={Compass}
        title="No games yet"
        description="Search for a game to start building the catalogue."
        action={<LinkButton href="/search">Search games</LinkButton>}
      />
    );
  }

  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm" role="status">
        Showing cached games — full catalogue browsing is temporarily
        unavailable.
      </p>
      <PosterGrid
        games={games.map((game) => ({
          slug: game.slug,
          name: game.name,
          coverImageId: game.cover_image_id,
          releaseYear: game.release_date
            ? new Date(game.release_date).getUTCFullYear()
            : null,
          source: "local" as const,
        }))}
      />
    </>
  );
}
