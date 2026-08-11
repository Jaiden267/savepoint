import { Heading } from "@/components/common/typography";
import { ratingToStars } from "@/lib/rating";
import type { RatingDistributionBucket } from "@/server/services/profile";

/**
 * Plain CSS bar list — no charting dependency added for this. 10 fixed rows
 * (dbRating 1-10, i.e. 0.5★-5★), zero-filled for ratings the user hasn't
 * used, sourced from the bounded `user_rating_distribution` view (migration
 * 19) rather than raw rows — see docs/SOCIAL.md.
 */
export function RatingDistribution({
  buckets,
}: {
  buckets: RatingDistributionBucket[];
}) {
  if (buckets.length === 0) return null;

  const byRating = new Map(buckets.map((b) => [b.dbRating, b.gameCount]));
  const maxCount = Math.max(...buckets.map((b) => b.gameCount));

  return (
    <section className="mt-10">
      <Heading level="h4" as="h2">
        Ratings distribution
      </Heading>
      <div className="mt-4 flex flex-col gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((dbRating) => {
          const count = byRating.get(dbRating) ?? 0;
          const widthPercent =
            maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
          return (
            <div key={dbRating} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-8 shrink-0 tabular-nums">
                {ratingToStars(dbRating).toFixed(1)}★
              </span>
              <div className="bg-muted h-3 flex-1 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
              <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
