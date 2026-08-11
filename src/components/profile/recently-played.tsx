import { PosterCard } from "@/components/games/poster-card";
import { Heading } from "@/components/common/typography";
import type { RecentlyPlayedEntry } from "@/server/services/profile";

export function RecentlyPlayed({
  entries,
}: {
  entries: RecentlyPlayedEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-10">
      <Heading level="h4" as="h2">
        Recently played
      </Heading>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        {entries.map((entry) => (
          <PosterCard
            key={entry.gameId}
            slug={entry.gameSlug}
            name={entry.gameName}
            coverImageId={entry.coverImageId}
            source="local"
          />
        ))}
      </div>
    </section>
  );
}
