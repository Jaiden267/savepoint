import { Skeleton } from "@/components/ui/skeleton";

// Shaped to match the real page's layout (game-hero.tsx + game-action-panel
// + game-metadata + rating line + review cards) rather than a generic
// block — this route's only real latency risk (an on-demand IGDB fetch on
// a cache miss) is exactly the kind of perceptible-delay route the state-
// file audit called out for a matching loading.tsx.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="border-border/60 flex flex-col gap-4 rounded-xl border p-6 sm:flex-row sm:items-end">
        <Skeleton className="aspect-[3/4] w-32 shrink-0 rounded-lg sm:w-40" />
        <div className="flex flex-1 flex-col gap-2 pb-1">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>

      <div className="mt-8 flex flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-40" />
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </main>
  );
}
