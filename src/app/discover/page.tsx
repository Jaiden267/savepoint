import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { IgdbAttribution } from "@/components/games/igdb-attribution";
import { PosterGridSkeleton } from "@/components/games/poster-grid";
import { DiscoverShuffleButton } from "@/components/games/discover-shuffle-button";
import { discoverSeedSchema } from "@/lib/validation/games";
import { DiscoverResults } from "./discover-results";

// Every ?seed= variant declares the bare path as canonical, so crawlers
// consolidate rather than crawl-budgeting every random seed as its own
// page — see docs/PINECONE.md's "Discover page" section.
export const metadata: Metadata = {
  title: "Discover",
  alternates: { canonical: "/discover" },
};

interface Props {
  searchParams: Promise<{ seed?: string }>;
}

function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export default async function DiscoverPage({ searchParams }: Props) {
  const { seed: seedParam } = await searchParams;
  const parsedSeed = discoverSeedSchema.safeParse(seedParam);
  if (!parsedSeed.success) {
    // No (or an invalid) seed — canonicalize to a fresh one before
    // rendering anything, so every real render is a pure function of the
    // URL. Every subsequent "Shuffle games" click, and every Back/
    // Forward through shuffle history, lands on a URL that already
    // carries its own seed.
    redirect(`/discover?seed=${freshSeed()}`);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageHeader title="Discover" action={<DiscoverShuffleButton />} />

      <Suspense key={parsedSeed.data} fallback={<PosterGridSkeleton />}>
        <DiscoverResults seed={parsedSeed.data} />
      </Suspense>

      <IgdbAttribution className="mt-10" />
    </main>
  );
}
