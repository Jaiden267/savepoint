import { Clock, Compass } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { getClientIdentifier } from "@/lib/auth/request-ip";
import {
  getRecommendations,
  RecommendationsRateLimitedError,
  RecommendationsUnavailableError,
  type RecommendationResult,
} from "@/server/services/recommendations";
import { PineconeIndexUnavailableError } from "@/lib/pinecone/client";
import { PineconeSearchError } from "@/lib/pinecone/search";
import { RecommendationGrid } from "@/components/recommendations/recommendation-grid";
import { ColdStartView } from "@/components/recommendations/cold-start-view";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";

type RecommendationsState =
  | {
      kind: "success";
      results: RecommendationResult[];
      mode: "personalized" | "preference-assisted";
      reduced: boolean;
    }
  | { kind: "cold-start" }
  | { kind: "rate-limited" }
  | { kind: "fallback" };

/** No JSX here — only data resolution, matching discover-results.tsx's resolveDiscoverState exactly (JSX construction inside try/catch doesn't actually get caught by it, since React defers rendering). */
async function resolveRecommendationsState(
  userId: string,
  seed: number,
  genreHints: string[] | undefined,
): Promise<RecommendationsState> {
  const supabase = await createClient();
  const clientId = await getClientIdentifier();

  try {
    const outcome = await getRecommendations(supabase, {
      userId,
      seed,
      clientId,
      genreHints,
    });
    if (outcome.coldStart) return { kind: "cold-start" };
    return {
      kind: "success",
      results: outcome.results,
      mode: outcome.mode,
      reduced: outcome.reduced,
    };
  } catch (err) {
    if (err instanceof RecommendationsRateLimitedError) {
      return { kind: "rate-limited" };
    }
    if (
      err instanceof RecommendationsUnavailableError ||
      err instanceof PineconeIndexUnavailableError ||
      err instanceof PineconeSearchError
    ) {
      return { kind: "fallback" };
    }
    throw err;
  }
}

/**
 * Not a route file — split out for direct testability, matching
 * discover-results.tsx/search-results.tsx's precedent exactly.
 */
export async function RecommendationsResults({
  seed,
  genreHints,
}: {
  seed: number;
  genreHints?: string[];
}) {
  const supabase = await createClient();
  // requireUser's redirect() must never be swallowed by a try/catch — it
  // runs before resolveRecommendationsState, which only wraps the
  // recommendations-specific error handling above, not auth.
  const user = await requireUser(supabase);
  const state = await resolveRecommendationsState(user.id, seed, genreHints);

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
    return (
      <EmptyState
        icon={Compass}
        title="Recommendations are temporarily unavailable"
        description="Personalized recommendations are temporarily unavailable. Try broad discovery instead."
        action={<LinkButton href="/discover">Browse Discover</LinkButton>}
      />
    );
  }

  if (state.kind === "cold-start") {
    const { data: genreRows } = await supabase
      .from("genres")
      .select("slug, name")
      .order("name")
      .limit(20);
    return <ColdStartView genres={genreRows ?? []} />;
  }

  return (
    <>
      {state.mode === "preference-assisted" ? (
        <p className="text-muted-foreground mb-4 text-sm" role="status">
          Preference-assisted discovery — based on your genre picks, not yet
          learned from your activity.
        </p>
      ) : null}
      {state.reduced ? (
        <p className="text-muted-foreground mb-4 text-sm" role="status">
          Showing fewer recommendations than usual right now.
        </p>
      ) : null}
      <RecommendationGrid results={state.results} />
    </>
  );
}
