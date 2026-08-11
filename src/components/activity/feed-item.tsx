import Link from "next/link";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/get-initials";
import { igdbImageUrl } from "@/lib/igdb/image-url";
import { starGlyphs } from "@/lib/rating";
import type { FeedActor, FeedItem } from "@/server/services/activity-feed";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ActorLink({ actor }: { actor: FeedActor }) {
  return (
    <Link
      href={`/users/${actor.username}`}
      className="focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md outline-none focus-visible:ring-3"
    >
      <Avatar size="sm">
        {actor.avatarUrl ? <AvatarImage src={actor.avatarUrl} alt="" /> : null}
        <AvatarFallback>
          {getInitials(actor.displayName || actor.username)}
        </AvatarFallback>
      </Avatar>
      <span className="text-foreground text-sm font-medium">
        {actor.displayName || actor.username}
      </span>
    </Link>
  );
}

function GameCover({ coverImageId }: { coverImageId: string | null }) {
  return (
    <div className="bg-muted relative aspect-[3/4] w-10 shrink-0 overflow-hidden rounded">
      {coverImageId ? (
        <Image
          src={igdbImageUrl(coverImageId, "thumb")}
          alt=""
          fill
          sizes="40px"
          className="object-cover"
        />
      ) : null}
    </div>
  );
}

function FeedItemVerb({ item }: { item: FeedItem }) {
  switch (item.eventType) {
    case "review_published":
      return (
        <span className="text-muted-foreground">
          reviewed{" "}
          <Link
            href={`/games/${item.game.slug}`}
            className="text-foreground hover:underline"
          >
            {item.game.name}
          </Link>
        </span>
      );
    case "game_rated":
      return (
        <span className="text-muted-foreground">
          rated{" "}
          <Link
            href={`/games/${item.game.slug}`}
            className="text-foreground hover:underline"
          >
            {item.game.name}
          </Link>
        </span>
      );
    case "game_completed":
      return (
        <span className="text-muted-foreground">
          completed{" "}
          <Link
            href={`/games/${item.game.slug}`}
            className="text-foreground hover:underline"
          >
            {item.game.name}
          </Link>
        </span>
      );
    case "diary_entry_logged":
      return (
        <span className="text-muted-foreground">
          {item.isReplay ? "replayed" : "played"}{" "}
          <Link
            href={`/games/${item.game.slug}`}
            className="text-foreground hover:underline"
          >
            {item.game.name}
          </Link>
        </span>
      );
    case "list_created":
      return (
        <span className="text-muted-foreground">
          created the list{" "}
          <Link
            href={`/lists/${item.listId}`}
            className="text-foreground hover:underline"
          >
            {item.title}
          </Link>
        </span>
      );
    case "follow_created":
      return (
        <span className="text-muted-foreground">
          followed{" "}
          <Link
            href={`/users/${item.followedUser.username}`}
            className="text-foreground hover:underline"
          >
            {item.followedUser.displayName || item.followedUser.username}
          </Link>
        </span>
      );
  }
}

function FeedItemBody({ item }: { item: FeedItem }) {
  if (item.eventType === "review_published") {
    return (
      <div className="mt-1">
        <span
          className="text-muted-foreground text-xs"
          aria-label={`${item.rating} out of 5 stars`}
        >
          {starGlyphs(item.rating)}
        </span>
        <p className="text-foreground mt-1 text-sm whitespace-pre-wrap">
          {item.bodySnippet}
        </p>
      </div>
    );
  }
  if (item.eventType === "game_rated") {
    return (
      <span
        className="text-muted-foreground text-xs"
        aria-label={`${item.rating} out of 5 stars`}
      >
        {starGlyphs(item.rating)}
      </span>
    );
  }
  return null;
}

/** Renders one activity_events row, branching on event_type — the feed's per-item card. */
export function FeedItemCard({ item }: { item: FeedItem }) {
  return (
    <article className="border-border flex gap-3 rounded-lg border p-4">
      {"game" in item ? (
        <Link href={`/games/${item.game.slug}`}>
          <GameCover coverImageId={item.game.coverImageId} />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <ActorLink actor={item.actor} />
          <FeedItemVerb item={item} />
        </div>
        <FeedItemBody item={item} />
        <p className="text-muted-foreground mt-1 text-xs">
          {formatDate(item.createdAt)}
        </p>
      </div>
    </article>
  );
}
