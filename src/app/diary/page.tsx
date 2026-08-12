import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listUserDiaryEntries } from "@/server/services/diary";
import { LogDiaryEntryDialog } from "@/components/games/log-diary-entry-dialog";
import { DeleteDiaryEntryButton } from "@/components/diary/delete-diary-entry-button";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";

export const metadata: Metadata = { title: "Diary" };

interface Props {
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function DiaryPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive — the proxy route policy already guards this page.
  if (!user) redirect("/login?next=/diary");

  const { entries, hasMore } = await listUserDiaryEntries({
    userId: user.id,
    page,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <PageHeader title="Diary" />

      {entries.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No plays logged yet"
          description="Log a play from any game page to start your diary."
          action={<LinkButton href="/discover">Discover games</LinkButton>}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="border-border flex flex-col gap-2 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/games/${entry.gameSlug}`}
                    className="text-foreground focus-visible:ring-ring/50 rounded-md text-sm font-medium outline-none focus-visible:ring-3"
                  >
                    {entry.gameName}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(entry.playedOn)}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {entry.rating !== null
                    ? `${entry.rating.toFixed(1)}★`
                    : "Not rated"}
                  {entry.isReplay ? " · Replay" : ""}
                </p>
                {entry.note ? (
                  <p className="text-foreground text-sm whitespace-pre-wrap">
                    {entry.note}
                  </p>
                ) : null}
                <div className="mt-1 flex gap-2">
                  <LogDiaryEntryDialog
                    gameId={entry.gameId}
                    gameSlug={entry.gameSlug}
                    triggerLabel="Edit"
                    triggerVariant="ghost"
                    triggerSize="sm"
                    defaults={{
                      entryId: entry.id,
                      playedOn: entry.playedOn,
                      rating: entry.rating,
                      isReplay: entry.isReplay,
                      note: entry.note,
                    }}
                  />
                  <DeleteDiaryEntryButton
                    entryId={entry.id}
                    gameSlug={entry.gameSlug}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            hasMore={hasMore}
            makeHref={(p) => `/diary?page=${p}`}
          />
        </>
      )}
    </main>
  );
}
