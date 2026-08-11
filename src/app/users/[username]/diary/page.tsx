import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import { getProfileByUsername } from "@/server/services/profile";
import { listUserDiaryEntries } from "@/server/services/diary";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";

export const metadata: Metadata = { title: "Diary" };

interface Props {
  params: Promise<{ username: string }>;
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

export default async function ProfileDiaryPage({
  params,
  searchParams,
}: Props) {
  const { username } = await params;
  const { page: pageParam } = await searchParams;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const page = parsePage(pageParam);
  const { entries, hasMore } = await listUserDiaryEntries({
    userId: profile.id,
    page,
  });

  return (
    <div>
      {entries.length === 0 ? (
        <EmptyState icon={BookOpen} title="No plays logged yet" />
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
              </li>
            ))}
          </ul>
          <nav
            className="mt-8 flex items-center justify-between"
            aria-label="Pagination"
          >
            {page > 1 ? (
              <LinkButton
                variant="secondary"
                size="sm"
                href={`/users/${username}/diary?page=${page - 1}`}
              >
                Previous
              </LinkButton>
            ) : (
              <span />
            )}
            {hasMore ? (
              <LinkButton
                variant="secondary"
                size="sm"
                href={`/users/${username}/diary?page=${page + 1}`}
              >
                Next
              </LinkButton>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </div>
  );
}
