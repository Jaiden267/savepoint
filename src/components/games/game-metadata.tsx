import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Heading, Text } from "@/components/common/typography";
import type { Tables } from "@/types/database";

type GameRow = Tables<"games">;

interface NamedRef {
  id: number;
  name: string;
  slug: string;
}

interface WebsiteEntry {
  type: string;
  url: string;
}

interface GameMetadataProps {
  game: GameRow;
  genres: NamedRef[];
  platforms: NamedRef[];
  gameModes: NamedRef[];
  themes: NamedRef[];
}

const WEBSITE_LABELS: Record<string, string> = {
  official: "Official site",
  steam: "Steam",
  gog: "GOG",
  epicgames: "Epic Games",
  wikipedia: "Wikipedia",
  twitter: "Twitter / X",
  x: "Twitter / X",
};

function isWebsiteEntry(value: unknown): value is WebsiteEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" && typeof record.url === "string";
}

/**
 * Re-validates every website URL as http(s) at render time — defense in
 * depth on top of the same check already applied at mapping time
 * (mappers.ts), matching this project's established pattern of re-checking
 * behind an already-trusted boundary.
 */
function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function TagRow({ label, items }: { label: string; items: NamedRef[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      {items.map((item) => (
        <Badge key={item.id} variant="secondary">
          {item.name}
        </Badge>
      ))}
    </div>
  );
}

export function GameMetadata({
  game,
  genres,
  platforms,
  gameModes,
  themes,
}: GameMetadataProps) {
  const rawWebsites: unknown = game.websites;
  const websites: WebsiteEntry[] = Array.isArray(rawWebsites)
    ? rawWebsites
        .filter(isWebsiteEntry)
        .filter((site) => isSafeHttpUrl(site.url))
    : [];

  const hasTags =
    genres.length > 0 ||
    platforms.length > 0 ||
    gameModes.length > 0 ||
    themes.length > 0;
  const hasCredits =
    game.developer_names.length > 0 || game.publisher_names.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {game.summary ? (
        <section>
          <Heading level="h4" as="h2" className="mb-2">
            Summary
          </Heading>
          <Text className="text-pretty">{game.summary}</Text>
        </section>
      ) : null}

      {game.storyline ? (
        <section>
          <Heading level="h4" as="h2" className="mb-2">
            Storyline
          </Heading>
          <Text className="text-pretty">{game.storyline}</Text>
        </section>
      ) : null}

      {hasTags ? (
        <section className="flex flex-col gap-3">
          <TagRow label="Genres" items={genres} />
          <TagRow label="Platforms" items={platforms} />
          <TagRow label="Modes" items={gameModes} />
          <TagRow label="Themes" items={themes} />
        </section>
      ) : null}

      {hasCredits ? (
        <>
          <Separator />
          <section className="flex flex-col gap-1 text-sm">
            {game.developer_names.length > 0 ? (
              <p>
                <span className="text-muted-foreground">Developer: </span>
                {game.developer_names.join(", ")}
              </p>
            ) : null}
            {game.publisher_names.length > 0 ? (
              <p>
                <span className="text-muted-foreground">Publisher: </span>
                {game.publisher_names.join(", ")}
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {websites.length > 0 ? (
        <>
          <Separator />
          <section className="flex flex-wrap gap-x-4 gap-y-2">
            {websites.map((site) => (
              <a
                key={site.url}
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
              >
                {WEBSITE_LABELS[site.type] ?? site.type}
              </a>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
