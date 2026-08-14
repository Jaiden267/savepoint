import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PosterGridSkeleton } from "@/components/games/poster-grid";
import { RecommendationsRegenerateButton } from "@/components/recommendations/recommendations-regenerate-button";
import { discoverSeedSchema } from "@/lib/validation/games";
import { recommendationGenreHintsSchema } from "@/lib/validation/recommendations";
import { RecommendationsResults } from "./recommendations-results";

// Every ?seed=/?genres= variant declares the bare path as canonical, so
// crawlers consolidate rather than crawl-budgeting every variant as its
// own page — same reasoning as /discover's metadata.
export const metadata: Metadata = {
  title: "For You",
  alternates: { canonical: "/recommendations" },
};

interface Props {
  searchParams: Promise<{ seed?: string; genres?: string }>;
}

function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export default async function RecommendationsPage({ searchParams }: Props) {
  const { seed: seedParam, genres: genresParam } = await searchParams;
  const parsedSeed = discoverSeedSchema.safeParse(seedParam);
  if (!parsedSeed.success) {
    // No (or an invalid) seed — canonicalize to a fresh one before
    // rendering anything, same pattern /discover uses, so every real
    // render (including Back/Forward through regenerations) is a pure
    // function of the URL. Preserves an existing genres hint across the
    // redirect.
    const params = new URLSearchParams();
    params.set("seed", String(freshSeed()));
    if (genresParam) params.set("genres", genresParam);
    redirect(`/recommendations?${params.toString()}`);
  }

  const genreSlugs = genresParam
    ? genresParam
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean)
    : [];
  const parsedHints = recommendationGenreHintsSchema.safeParse(genreSlugs);
  const genreHints = parsedHints.success ? parsedHints.data : undefined;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageHeader
        title="For You"
        description="Personalized recommendations based on your ratings, library, and reviews."
        action={<RecommendationsRegenerateButton />}
      />

      <Suspense
        key={`${parsedSeed.data}:${genreHints?.join(",") ?? ""}`}
        fallback={<PosterGridSkeleton />}
      >
        <RecommendationsResults
          seed={parsedSeed.data}
          genreHints={genreHints}
        />
      </Suspense>
    </main>
  );
}
