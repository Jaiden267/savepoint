"use client";

import { useActionState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { importCatalogueGameAction } from "@/server/actions/games";
import { initialActionState } from "@/lib/action-state";
import { igdbImageUrl } from "@/lib/igdb/image-url";
import { cn } from "@/lib/utils";

export interface CatalogueResultCardProps {
  igdbId: number;
  name: string;
  coverImageId: string | null;
  releaseYear?: number | null;
  className?: string;
}

function SubmitOverlay() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div
      className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-lg"
      aria-hidden="true"
    >
      <Loader2 className="text-foreground size-6 animate-spin" />
    </div>
  );
}

/**
 * Visually matches `PosterCard` (same poster/aspect-ratio classes), but
 * for a game with no Supabase row yet — a real `<form>` + `<button
 * type="submit">` instead of a `<Link>`, so opening it is a deliberate
 * POST rather than a plain GET a crawler or prefetcher could trigger. See
 * src/server/actions/games.ts's importCatalogueGameAction and
 * docs/PINECONE.md's "on-demand import boundary" section.
 */
export function CatalogueResultCard({
  igdbId,
  name,
  coverImageId,
  releaseYear,
  className,
}: CatalogueResultCardProps) {
  const [state, formAction] = useActionState(
    importCatalogueGameAction,
    initialActionState,
  );

  return (
    <form action={formAction} className={cn("flex flex-col gap-2", className)}>
      <input type="hidden" name="igdbId" value={igdbId} />
      <button
        type="submit"
        aria-label={`Import and open ${name}`}
        className="group focus-visible:ring-ring/50 relative flex flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-3"
      >
        <span className="bg-muted relative block aspect-[3/4] w-full overflow-hidden rounded-lg">
          {coverImageId ? (
            <Image
              src={igdbImageUrl(coverImageId, "cover_big")}
              alt=""
              fill
              sizes="(min-width: 1024px) 200px, (min-width: 640px) 33vw, 50vw"
              className="object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : (
            <span className="text-muted-foreground flex size-full items-center justify-center px-2 text-center text-xs">
              No cover art
            </span>
          )}
          <SubmitOverlay />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-foreground line-clamp-2 text-sm font-medium">
            {name}
          </span>
          {releaseYear ? (
            <span className="text-muted-foreground text-xs">{releaseYear}</span>
          ) : null}
        </span>
      </button>
      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
