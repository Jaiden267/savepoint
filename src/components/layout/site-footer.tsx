import { LinkButton } from "@/components/common/link-button";

export function SiteFooter() {
  return (
    <footer className="border-border/60 border-t">
      {/*
       * A plain flex row with justify-between only centres the middle item
       * when the two outer items happen to be the same width — with real
       * copyright/tagline text of different lengths, the Privacy link drifts
       * off the true horizontal centre. The fix is the standard robust
       * three-column grid: the outer minmax(0,1fr) columns always consume
       * equal leftover space regardless of their content's length, so the
       * auto-sized middle column (and the Privacy link inside it) stays
       * exactly centred on the row. Below `sm`, it collapses to a single
       * centred column, matching the previous stacked mobile layout.
       */}
      <div className="text-muted-foreground mx-auto grid max-w-6xl grid-cols-1 items-center gap-2 px-4 py-6 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-6">
        <p className="justify-self-center sm:justify-self-start">
          &copy; {new Date().getFullYear()} Savepoint.
        </p>
        <LinkButton
          variant="link"
          size="sm"
          href="/privacy"
          className="justify-self-center"
        >
          Privacy
        </LinkButton>
        <p className="justify-self-center sm:justify-self-end">
          Track, rate and discover the games you play.
        </p>
      </div>
    </footer>
  );
}
