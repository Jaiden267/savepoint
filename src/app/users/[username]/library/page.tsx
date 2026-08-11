import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LibraryBig } from "lucide-react";
import { getProfileByUsername } from "@/server/services/profile";
import { listUserLibrary } from "@/server/services/library";
import { PosterCard } from "@/components/games/poster-card";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";

export const metadata: Metadata = { title: "Library" };

interface Props {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * A profile's Library tab is read-only, even for the owner — editing lives
 * on the dedicated /library page (status tabs, sort, remove). Linked here
 * rather than duplicating owner-only controls on a page that's otherwise a
 * public, browsable surface.
 */
export default async function ProfileLibraryPage({
  params,
  searchParams,
}: Props) {
  const { username } = await params;
  const { page: pageParam } = await searchParams;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const page = parsePage(pageParam);
  const { entries, hasMore } = await listUserLibrary({
    userId: profile.id,
    status: null,
    page,
  });

  return (
    <div>
      {entries.length === 0 ? (
        <EmptyState icon={LibraryBig} title="No games in this library yet" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {entries.map((entry) => (
              <div key={entry.gameId} className="flex flex-col gap-1">
                <PosterCard
                  slug={entry.gameSlug}
                  name={entry.gameName}
                  coverImageId={entry.coverImageId}
                  source="local"
                />
                <p className="text-muted-foreground text-xs capitalize">
                  {entry.status}
                  {entry.rating !== null
                    ? ` · ${entry.rating.toFixed(1)}★`
                    : ""}
                </p>
              </div>
            ))}
          </div>
          <nav
            className="mt-8 flex items-center justify-between"
            aria-label="Pagination"
          >
            {page > 1 ? (
              <LinkButton
                variant="secondary"
                size="sm"
                href={`/users/${username}/library?page=${page - 1}`}
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
                href={`/users/${username}/library?page=${page + 1}`}
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
