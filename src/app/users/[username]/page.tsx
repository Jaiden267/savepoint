import { notFound } from "next/navigation";
import {
  getProfileByUsername,
  getRecentlyPlayed,
  getFavouriteGames,
  getRatingDistribution,
} from "@/server/services/profile";
import { RecentlyPlayed } from "@/components/profile/recently-played";
import { FavouriteGames } from "@/components/profile/favourite-games";
import { RatingDistribution } from "@/components/profile/rating-distribution";

interface Props {
  params: Promise<{ username: string }>;
}

export default async function UserOverviewPage({ params }: Props) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  // The segment layout already checked this — re-checked defensively in
  // case this page is ever reached without its layout (e.g. a future
  // parallel-route change), never trusting the parent alone.
  if (!profile) notFound();

  const [recentlyPlayed, favourites, distribution] = await Promise.all([
    getRecentlyPlayed(profile.id),
    getFavouriteGames(profile.id),
    getRatingDistribution(profile.id),
  ]);

  const hasAnyContent =
    recentlyPlayed.length > 0 ||
    favourites.length > 0 ||
    distribution.length > 0;

  return (
    <div>
      <RecentlyPlayed entries={recentlyPlayed} />
      <FavouriteGames entries={favourites} />
      <RatingDistribution buckets={distribution} />
      {!hasAnyContent ? (
        <p className="text-muted-foreground mt-10 text-center text-sm">
          No activity yet.
        </p>
      ) : null}
    </div>
  );
}
