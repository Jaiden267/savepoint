import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LibraryBig } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listUserLibrary, type LibrarySort } from "@/server/services/library";
import {
  libraryStatusSchema,
  type LibraryStatus,
} from "@/lib/validation/library";
import { LibraryEntryCard } from "@/components/library/library-entry-card";
import { GRID_CLASSES } from "@/components/games/poster-grid";
import { SortSelect } from "@/components/library/sort-select";
import { IgdbAttribution } from "@/components/games/igdb-attribution";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Library" };

interface Props {
  searchParams: Promise<{ status?: string; sort?: string; page?: string }>;
}

const STATUS_TABS: { value: LibraryStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "wishlist", label: "Wishlist" },
  { value: "backlog", label: "Backlog" },
  { value: "playing", label: "Playing" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "dropped", label: "Dropped" },
];

const SORT_VALUES: LibrarySort[] = ["updated", "rating_desc", "alpha"];

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseSort(raw: string | undefined): LibrarySort {
  return SORT_VALUES.includes(raw as LibrarySort)
    ? (raw as LibrarySort)
    : "updated";
}

function libraryHref(
  status: LibraryStatus | null,
  sort: LibrarySort,
  page?: number,
) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (sort !== "updated") params.set("sort", sort);
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/library?${qs}` : "/library";
}

export default async function LibraryPage({ searchParams }: Props) {
  const {
    status: statusParam,
    sort: sortParam,
    page: pageParam,
  } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive — the proxy route policy already guards this page.
  if (!user) redirect("/login?next=/library");

  const parsedStatus = libraryStatusSchema.safeParse(statusParam);
  const status = parsedStatus.success ? parsedStatus.data : null;
  const sort = parseSort(sortParam);
  const page = parsePage(pageParam);

  const { entries, hasMore } = await listUserLibrary({
    userId: user.id,
    status,
    sort,
    page,
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageHeader title="Library" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Library status"
          className="bg-muted inline-flex w-fit flex-wrap items-center gap-1 rounded-lg p-1"
        >
          {STATUS_TABS.map((tab) => {
            const active = tab.value === status;
            return (
              <Link
                key={tab.label}
                href={libraryHref(tab.value, sort)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex h-7 items-center justify-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <SortSelect status={status} sort={sort} />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={LibraryBig}
          title="Nothing here yet"
          description="Add a game to your library from its game page to start tracking it."
          action={<LinkButton href="/discover">Discover games</LinkButton>}
        />
      ) : (
        <>
          <div className={GRID_CLASSES}>
            {entries.map((entry) => (
              <LibraryEntryCard key={entry.gameId} entry={entry} />
            ))}
          </div>
          <Pagination
            page={page}
            hasMore={hasMore}
            makeHref={(p) => libraryHref(status, sort, p)}
          />
        </>
      )}

      <IgdbAttribution className="mt-10" />
    </main>
  );
}
