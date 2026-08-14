"use client";

import { useState, useTransition } from "react";
import {
  ThumbsUp,
  ThumbsDown,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";
import { toggleRecommendationFeedbackAction } from "@/server/actions/recommendations";
import { Button } from "@/components/ui/button";

type FeedbackType = "saved" | "dismissed" | "completed";

interface FeedbackButtonConfig {
  type: FeedbackType;
  label: string;
  description: string;
  icon: LucideIcon;
}

/**
 * "Helpful"/"Not interested"/"Already played" all write to
 * recommendation_feedback only — never user_games, never a list. See
 * docs/RECOMMENDATIONS.md for the full event_type mapping. The
 * description text is the accessible way this is made explicit in the UI,
 * not just a code comment — "Already played" in particular must never
 * read as if it updates the user's library.
 */
const BUTTONS: FeedbackButtonConfig[] = [
  {
    type: "saved",
    label: "Helpful",
    description: "This suggestion was useful — helps future recommendations",
    icon: ThumbsUp,
  },
  {
    type: "dismissed",
    label: "Not interested",
    description: "Won't recommend this again",
    icon: ThumbsDown,
  },
  {
    type: "completed",
    label: "Already played",
    description: "Won't recommend this again — doesn't change your library",
    icon: CircleCheck,
  },
];

export function RecommendationFeedbackButtons({ igdbId }: { igdbId: number }) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="group"
      aria-label="Feedback on this recommendation"
    >
      {BUTTONS.map((config) => (
        <FeedbackButton key={config.type} igdbId={igdbId} config={config} />
      ))}
    </div>
  );
}

/**
 * Plain `useState`, not `useOptimistic` — deliberately. `useOptimistic`
 * only displays its optimistic value *while* a transition is pending; once
 * the transition settles it reverts to the value last passed to the hook
 * (its "base"), which here has no real server-driven prop feeding it a
 * fresh value on success (unlike follow-button.tsx/review-card.tsx's like
 * button, which get revalidated server data back through their parent).
 * Using `useOptimistic` here would make a successful toggle visibly flash
 * pressed and then snap back to unpressed once the transition completes —
 * a real bug, caught by testing the post-resolution state, not just the
 * pending state. `useState` has no such reversion: it holds whatever it
 * was last explicitly set to.
 */
function FeedbackButton({
  igdbId,
  config,
}: {
  igdbId: number;
  config: FeedbackButtonConfig;
}) {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState(false);
  const Icon = config.icon;

  function handleClick() {
    const nextActive = !active;
    const previousActive = active;
    setActive(nextActive);
    startTransition(async () => {
      const result = await toggleRecommendationFeedbackAction(
        igdbId,
        config.type,
      );
      setActive(result.status === "success" ? result.active : previousActive);
    });
  }

  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      disabled={isPending}
      aria-pressed={active}
      title={config.description}
      onClick={handleClick}
      className="text-xs"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {config.label}
    </Button>
  );
}
