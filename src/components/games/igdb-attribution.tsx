import { cn } from "@/lib/utils";

/** Required attribution wherever IGDB-sourced game data is shown. */
export function IgdbAttribution({ className }: { className?: string }) {
  return (
    <p className={cn("text-muted-foreground text-xs", className)}>
      Game data provided by{" "}
      <a
        href="https://www.igdb.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-foreground underline underline-offset-2"
      >
        IGDB
      </a>
      .
    </p>
  );
}
