"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const STAR_VALUES = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5] as const;

interface StarRatingInputBaseProps {
  /** Accessible group label, e.g. "Your rating". */
  "aria-label": string;
  /**
   * Sets the native `required` attribute on every radio in the group. HTML5
   * group semantics block submission and show native validation UI if none
   * is checked — only meaningful inside a real <form> submit, not an
   * auto-submitting onChange flow where a value always already exists.
   */
  required?: boolean;
  className?: string;
  /** Fires with the newly selected value on any radio's native change event — drives controlled state and/or a submit-on-change side effect. */
  onChange?: (value: number) => void;
}

interface ControlledProps extends StarRatingInputBaseProps {
  /** Controlled mode: value is real React state; a "Clear" affordance calls onChange(null) from outside this component. */
  value: number | null;
  name?: never;
  defaultValue?: never;
}

interface UncontrolledProps extends StarRatingInputBaseProps {
  /** Uncontrolled mode: the browser owns which radio is checked; read via FormData at submit time. */
  name: string;
  defaultValue?: number | null;
  value?: never;
}

export type StarRatingInputProps = ControlledProps | UncontrolledProps;

function isControlledProps(
  props: StarRatingInputProps,
): props is ControlledProps {
  return "value" in props && props.value !== undefined;
}

function starLabel(value: number): string {
  return `${value} star${value === 1 ? "" : "s"}`;
}

/**
 * 10 half-star radio steps rendered as sr-only inputs paired with visible
 * star labels. DOM order is descending (5 down to 0.5) inside a
 * flex-row-reverse container, so the visual order reads left-to-right
 * 0.5→5.0 while Tailwind's shared `peer`/`peer-checked` general-sibling
 * selector naturally fills a star AND every star after it in the DOM
 * (i.e. every lower value) when any one input is checked — no JS needed for
 * the fill effect. Hover preview uses the same general-sibling trick applied
 * directly to the (visible, hoverable) labels.
 */
export function StarRatingInput(props: StarRatingInputProps) {
  const generatedName = React.useId();
  const controlled = isControlledProps(props);
  const name = controlled ? generatedName : props.name;

  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      className={cn("flex flex-row-reverse gap-0.5", props.className)}
    >
      {STAR_VALUES.map((option) => {
        const inputId = `${name}-${option}`;
        return (
          <React.Fragment key={option}>
            <input
              type="radio"
              id={inputId}
              name={name}
              value={option}
              required={props.required}
              checked={controlled ? props.value === option : undefined}
              defaultChecked={
                controlled ? undefined : props.defaultValue === option
              }
              onChange={() => props.onChange?.(option)}
              className="peer sr-only"
            />
            <label
              htmlFor={inputId}
              className={cn(
                "text-muted-foreground/40 cursor-pointer rounded-sm p-0.5 transition-colors outline-none",
                "peer-checked:text-primary",
                "hover:text-primary [&:hover~label]:text-primary",
                "peer-focus-visible:ring-ring peer-focus-visible:ring-offset-background peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
              )}
            >
              <Star aria-hidden="true" className="size-5 fill-current" />
              <span className="sr-only">{starLabel(option)}</span>
            </label>
          </React.Fragment>
        );
      })}
    </div>
  );
}
