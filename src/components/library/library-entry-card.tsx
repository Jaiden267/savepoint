import Image from "next/image";
import Link from "next/link";
import { igdbImageUrl } from "@/lib/igdb/image-url";
import { Badge } from "@/components/ui/badge";
import type { LibraryEntry } from "@/server/services/library";

const STATUS_LABELS: Record<LibraryEntry["status"], string> = {
  wishlist: "Wishlist",
  backlog: "Backlog",
  playing: "Playing",
  completed: "Completed",
  paused: "Paused",
  dropped: "Dropped",
};

/** A single /library grid cell — poster + status badge + rating, distinct from PosterCard (discover/search) which has no per-user state to show. */
export function LibraryEntryCard({ entry }: { entry: LibraryEntry }) {
  return (
    <Link
      href={`/games/${entry.gameSlug}`}
      className="group focus-visible:ring-ring/50 flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-3"
    >
      <div className="bg-muted relative aspect-[3/4] w-full overflow-hidden rounded-lg">
        {entry.coverImageId ? (
          <Image
            src={igdbImageUrl(entry.coverImageId, "cover_big")}
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
        <Badge variant="secondary" className="absolute top-2 left-2">
          {STATUS_LABELS[entry.status]}
        </Badge>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground line-clamp-2 text-sm font-medium">
          {entry.gameName}
        </p>
        <p className="text-muted-foreground text-xs">
          {entry.rating !== null ? `${entry.rating.toFixed(1)}★` : "Not rated"}
          {entry.releaseYear ? ` · ${entry.releaseYear}` : ""}
        </p>
      </div>
    </Link>
  );
}
