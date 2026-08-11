import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/common/typography";
import { cn } from "@/lib/utils";
import type { ListVisibility } from "@/lib/validation/lists";

export interface ListCardProps {
  id: string;
  title: string;
  description: string | null;
  isRanked: boolean;
  visibility: ListVisibility;
  itemCount: number;
  author?: { username: string; displayName: string | null } | null;
  className?: string;
}

export function ListCard({
  id,
  title,
  description,
  isRanked,
  visibility,
  itemCount,
  author,
  className,
}: ListCardProps) {
  return (
    <Link
      href={`/lists/${id}`}
      className={cn(
        "border-border focus-visible:ring-ring/50 hover:bg-muted/40 flex flex-col gap-1.5 rounded-lg border p-4 outline-none focus-visible:ring-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-foreground text-sm font-medium">{title}</p>
        {visibility !== "public" ? (
          <Badge variant="outline">
            {visibility === "private" ? "Private" : "Unlisted"}
          </Badge>
        ) : null}
      </div>
      {description ? (
        <Text tone="muted" size="sm" className="line-clamp-2">
          {description}
        </Text>
      ) : null}
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 text-xs">
        <span>
          {itemCount} game{itemCount === 1 ? "" : "s"}
        </span>
        {isRanked ? <span>· Ranked</span> : null}
        {author ? (
          <span>· by {author.displayName || author.username}</span>
        ) : null}
      </div>
    </Link>
  );
}
