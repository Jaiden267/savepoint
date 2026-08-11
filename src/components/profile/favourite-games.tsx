import { PosterCard } from "@/components/games/poster-card";
import { Heading } from "@/components/common/typography";
import { starGlyphs } from "@/lib/rating";
import type { FavouriteGameEntry } from "@/server/services/profile";

export function FavouriteGames({ entries }: { entries: FavouriteGameEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-10">
      <Heading level="h4" as="h2">
        Favourites
      </Heading>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        {entries.map((entry) => (
          <div key={entry.gameId} className="flex flex-col gap-1">
            <PosterCard
              slug={entry.gameSlug}
              name={entry.gameName}
              coverImageId={entry.coverImageId}
              source="local"
            />
            <span
              className="text-muted-foreground text-xs"
              aria-label={`${entry.rating} out of 5 stars`}
            >
              {starGlyphs(entry.rating)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
