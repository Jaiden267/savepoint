"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/common/link-button";
import { EmptyState } from "@/components/common/empty-state";

export interface ColdStartGenre {
  slug: string;
  name: string;
}

function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * Cold-start experience for a user with fewer than 3 positive signals.
 * Never fabricates a personalized confidence — explains why, offers broad
 * discovery, and an optional genre picker that only ever biases one
 * request (never stored) toward "preference-assisted discovery," a
 * distinct, honestly-labeled mode from full personalization (see
 * getRecommendations' `mode` field and docs/RECOMMENDATIONS.md).
 */
export function ColdStartView({ genres }: { genres: ColdStartGenre[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleGenre(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function handleSubmit() {
    const params = new URLSearchParams();
    params.set("seed", String(freshSeed()));
    if (selected.size > 0) {
      params.set("genres", [...selected].join(","));
    }
    router.push(`/recommendations?${params.toString()}`);
  }

  return (
    <EmptyState
      icon={Sparkles}
      title="Rate a few games to get personalized recommendations"
      description="The more you rate, complete, or review, the better Savepoint can explain why a game fits your taste. In the meantime, explore the broad catalogue, or pick a few genres below for a lightweight starting point — not full personalization, just a nudge."
      action={
        <div className="flex flex-col items-center gap-4">
          <LinkButton href="/discover">Browse Discover</LinkButton>
          {genres.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <div
                className="flex flex-wrap justify-center gap-2"
                role="group"
                aria-label="Genre preferences"
              >
                {genres.map((genre) => (
                  <Button
                    key={genre.slug}
                    type="button"
                    variant={selected.has(genre.slug) ? "secondary" : "outline"}
                    size="sm"
                    aria-pressed={selected.has(genre.slug)}
                    onClick={() => toggleGenre(genre.slug)}
                  >
                    {genre.name}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={selected.size === 0}
              >
                Show me something in these genres
              </Button>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
