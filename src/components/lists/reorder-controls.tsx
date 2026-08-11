"use client";

import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ReorderDirection = "up" | "down" | "top" | "bottom";

interface ReorderControlsProps {
  index: number;
  total: number;
  disabled?: boolean;
  onMove: (direction: ReorderDirection) => void;
}

/**
 * Accessible up/down/top/bottom reordering for ranked list items — real
 * `<button>`s with descriptive `aria-label`s, fully keyboard- and
 * screen-reader-usable, disabled at the array boundaries. No
 * drag-and-drop this prompt (see docs/SOCIAL.md).
 */
export function ReorderControls({
  index,
  total,
  disabled,
  onMove,
}: ReorderControlsProps) {
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <div
      className="flex flex-col items-center gap-0.5"
      role="group"
      aria-label={`Reorder item ${index + 1} of ${total}`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled || isFirst}
        aria-label="Move to top"
        onClick={() => onMove("top")}
      >
        <ChevronsUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled || isFirst}
        aria-label="Move up"
        onClick={() => onMove("up")}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <span className="text-muted-foreground text-xs tabular-nums">
        {index + 1}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled || isLast}
        aria-label="Move down"
        onClick={() => onMove("down")}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled || isLast}
        aria-label="Move to bottom"
        onClick={() => onMove("bottom")}
      >
        <ChevronsDown aria-hidden="true" />
      </Button>
    </div>
  );
}
