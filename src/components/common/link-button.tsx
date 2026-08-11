import Link from "next/link";
import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * A Next.js `<Link>` styled like a Button. Base UI's Button primitive
 * enforces real button semantics (role="button", keyboard handling) and its
 * docs say links shouldn't be routed through Button's `render` prop — an
 * `<a>` has its own native semantics Button would otherwise override. This
 * applies the same variant/size classes directly to a real `<Link>` instead,
 * so navigation keeps native anchor behavior (keyboard, focus, screen
 * readers) with no Base UI warning.
 */
export function LinkButton({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
