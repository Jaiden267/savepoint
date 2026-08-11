import Image from "next/image";
import Link from "next/link";
import { igdbImageUrl } from "@/lib/igdb/image-url";
import { cn } from "@/lib/utils";

export interface PosterCardProps {
  slug: string;
  name: string;
  coverImageId: string | null;
  releaseYear?: number | null;
  /**
   * `"igdb"` results aren't imported into the local cache yet — the link
   * disables Next's default prefetch so merely rendering a results list
   * can never trigger an import (see game-sync.ts's abuse boundary).
   * `"local"` results are already-cached reads, safe to prefetch normally.
   */
  source: "local" | "igdb";
  className?: string;
}

/** Poster + title + meta line, matching poster-card-skeleton.tsx's shape exactly. */
export function PosterCard({
  slug,
  name,
  coverImageId,
  releaseYear,
  source,
  className,
}: PosterCardProps) {
  return (
    <Link
      href={`/games/${slug}`}
      prefetch={source === "local" ? undefined : false}
      className={cn(
        "group focus-visible:ring-ring/50 flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-3",
        className,
      )}
    >
      <div className="bg-muted relative aspect-[3/4] w-full overflow-hidden rounded-lg">
        {coverImageId ? (
          <Image
            src={igdbImageUrl(coverImageId, "cover_big")}
            alt=""
            fill
            sizes="(min-width: 1024px) 200px, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center px-2 text-center text-xs">
            No cover art
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground line-clamp-2 text-sm font-medium">
          {name}
        </p>
        {releaseYear ? (
          <p className="text-muted-foreground text-xs">{releaseYear}</p>
        ) : null}
      </div>
    </Link>
  );
}
