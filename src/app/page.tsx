import { Library, NotebookPen, Sparkles } from "lucide-react";
import { LinkButton } from "@/components/common/link-button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Heading, Text } from "@/components/common/typography";

const features = [
  {
    icon: Library,
    title: "Track everything you play",
    description:
      "Wishlist, backlog, playing, completed, paused or dropped — plus half-star ratings and a proper gaming diary.",
  },
  {
    icon: NotebookPen,
    title: "Write reviews people read",
    description:
      "Spoiler-aware reviews with likes and comments, ranked or unranked lists, and a profile that shows your taste.",
  },
  {
    icon: Sparkles,
    title: "Discover what's next",
    description:
      "Semantic search and recommendations that explain themselves — no black-box suggestions.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="flex flex-col items-center px-6 py-24 text-center">
        <div className="w-full max-w-xl">
          <Text
            tone="muted"
            size="sm"
            className="mb-4 font-medium tracking-widest uppercase"
          >
            Savepoint
          </Text>
          <Heading level="h1">
            Track, rate and discover the games you play.
          </Heading>
          <Text tone="muted" className="mx-auto mt-6 max-w-md text-pretty">
            A social home for your backlog, diary and reviews — with semantic
            search and recommendations that explain themselves.
          </Text>
          <div className="mt-10 flex items-center justify-center gap-3">
            <LinkButton size="lg" href="/signup">
              Get started
            </LinkButton>
            <LinkButton variant="secondary" size="lg" href="/search">
              Browse games
            </LinkButton>
          </div>
        </div>
      </section>

      <section className="border-border/60 border-t px-6 py-16">
        <div className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title}>
              <CardHeader>
                <div className="bg-muted text-foreground mb-2 flex size-9 items-center justify-center rounded-md">
                  <Icon className="size-4.5" aria-hidden="true" />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
