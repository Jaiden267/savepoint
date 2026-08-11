import {
  PosterCard,
  type PosterCardProps,
} from "@/components/games/poster-card";
import { PosterCardSkeleton } from "@/components/games/poster-card-skeleton";
import { cn } from "@/lib/utils";

const GRID_CLASSES =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

export function PosterGrid({
  games,
  className,
}: {
  games: PosterCardProps[];
  className?: string;
}) {
  return (
    <div className={cn(GRID_CLASSES, className)}>
      {games.map((game) => (
        <PosterCard key={`${game.source}-${game.slug}`} {...game} />
      ))}
    </div>
  );
}

export function PosterGridSkeleton({
  count = 10,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn(GRID_CLASSES, className)}>
      {Array.from({ length: count }, (_, index) => (
        <PosterCardSkeleton key={index} />
      ))}
    </div>
  );
}
