import Image from "next/image";
import { igdbImageUrl } from "@/lib/igdb/image-url";
import { Heading } from "@/components/common/typography";
import type { Tables } from "@/types/database";

type GameRow = Tables<"games">;

/** Hero: backdrop (artwork/screenshot), cover, name, release year, IGDB rating. No community/stats section — that's Prompt 4 territory. */
export function GameHero({ game }: { game: GameRow }) {
  const backdropImageId =
    game.artwork_image_ids[0] ?? game.screenshot_image_ids[0] ?? null;
  const releaseYear = game.release_date
    ? new Date(game.release_date).getUTCFullYear()
    : null;
  const rating =
    game.igdb_rating !== null ? Math.round(game.igdb_rating) : null;

  return (
    <div className="border-border/60 relative overflow-hidden rounded-xl border">
      {backdropImageId ? (
        <div className="absolute inset-0">
          <Image
            src={igdbImageUrl(backdropImageId, "1080p")}
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-cover opacity-25"
          />
          <div className="from-background via-background/60 absolute inset-0 bg-gradient-to-t to-transparent" />
        </div>
      ) : (
        <div className="bg-card absolute inset-0" />
      )}
      <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-end">
        <div className="bg-muted relative aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-lg shadow-lg sm:w-40">
          {game.cover_image_id ? (
            <Image
              src={igdbImageUrl(game.cover_image_id, "cover_big")}
              alt=""
              fill
              sizes="160px"
              className="object-cover"
            />
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-2 pb-1">
          <Heading level="h2" as="h1">
            {game.name}
          </Heading>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {releaseYear ? <span>{releaseYear}</span> : null}
            {rating !== null ? <span>IGDB rating: {rating}/100</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
