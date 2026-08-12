import { Skeleton } from "@/components/ui/skeleton";
import { GRID_CLASSES } from "@/components/games/poster-grid";

// The overview tab was the one profile tab without a loading.tsx — its 6
// sibling tabs (library/diary/reviews/lists/followers/following) each have
// one for the same Promise.all-of-Supabase-queries latency profile. Shaped
// to roughly match recently-played/favourites poster rows + the ratings bar
// list, not a generic block.
export default function Loading() {
  return (
    <div>
      <div className="mt-10">
        <Skeleton className="h-6 w-40" />
        <div className={`mt-4 ${GRID_CLASSES}`}>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="aspect-[3/4] w-full rounded-lg" />
          ))}
        </div>
      </div>
      <div className="mt-10">
        <Skeleton className="h-6 w-32" />
        <div className="mt-4 flex flex-col gap-1.5">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="h-3 w-full rounded-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
