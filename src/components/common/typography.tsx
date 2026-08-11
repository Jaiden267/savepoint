import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const headingVariants = cva("font-semibold tracking-tight text-balance", {
  variants: {
    level: {
      h1: "text-4xl sm:text-5xl",
      h2: "text-3xl sm:text-4xl",
      h3: "text-2xl sm:text-3xl",
      h4: "text-xl sm:text-2xl",
    },
  },
  defaultVariants: {
    level: "h1",
  },
});

type HeadingLevel = NonNullable<VariantProps<typeof headingVariants>["level"]>;

type HeadingProps = Omit<React.ComponentProps<"h1">, "className"> &
  VariantProps<typeof headingVariants> & {
    /** Renders as this element regardless of visual `level`. */
    as?: HeadingLevel;
    className?: string;
  };

/** Semantic heading with a Savepoint-consistent size scale. */
function Heading({ className, level = "h1", as, ...props }: HeadingProps) {
  const Comp = as ?? (level as HeadingLevel);
  return (
    <Comp className={cn(headingVariants({ level }), className)} {...props} />
  );
}

const textVariants = cva("", {
  variants: {
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
    },
    size: {
      sm: "text-sm",
      base: "text-base",
      lg: "text-lg",
    },
  },
  defaultVariants: {
    tone: "default",
    size: "base",
  },
});

type TextProps = React.ComponentProps<"p"> & VariantProps<typeof textVariants>;

/** Body text with the app's default tone/size scale. */
function Text({ className, tone, size, ...props }: TextProps) {
  return (
    <p className={cn(textVariants({ tone, size }), className)} {...props} />
  );
}

export { Heading, Text, headingVariants, textVariants };
