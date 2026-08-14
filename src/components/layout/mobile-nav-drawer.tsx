"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/common/submit-button";
import { signOutAction } from "@/server/actions/auth";
import { cn } from "@/lib/utils";

const NAV_LINK_CLASSES =
  "hover:bg-muted text-foreground flex min-h-11 items-center rounded-lg px-3 text-sm font-medium";

interface MobileNavDrawerProps {
  /** Signed-in username, or `null` when signed out — drives which links show. */
  username: string | null;
  className?: string;
}

/**
 * Hamburger-triggered secondary nav for the mobile header, `md:hidden`.
 * Links are plain `<Link>`s (not composed via `DrawerClose`'s `render` prop
 * — that forces `role="button"` onto the composed element regardless of
 * `nativeButton`, breaking real link semantics; confirmed by
 * mobile-nav-drawer.test.tsx, matching the same trap link-button.tsx's own
 * comment already documents for Button). The drawer is controlled instead,
 * so each link's own `onClick` closes it — App Router keeps the layout (and
 * this drawer's state) mounted across client-side navigations, so without
 * this it would stay open over the next page.
 */
export function MobileNavDrawer({ username, className }: MobileNavDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        aria-label="Open menu"
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "min-h-11 min-w-11",
          className,
        )}
      >
        <Menu aria-hidden="true" />
      </DrawerTrigger>
      <DrawerPopup>
        <div className="flex items-center justify-between">
          <DrawerTitle>Menu</DrawerTitle>
          <DrawerClose
            aria-label="Close menu"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "min-h-11 min-w-11",
            )}
          >
            <X aria-hidden="true" />
          </DrawerClose>
        </div>
        <DrawerDescription className="sr-only">
          Secondary navigation
        </DrawerDescription>
        <nav className="mt-2 flex flex-col gap-1" aria-label="Secondary">
          {username ? (
            <>
              <Link
                href="/discover/community"
                onClick={() => setOpen(false)}
                className={NAV_LINK_CLASSES}
              >
                Community
              </Link>
              <Link
                href="/recommendations"
                onClick={() => setOpen(false)}
                className={NAV_LINK_CLASSES}
              >
                For You
              </Link>
              <Link
                href={`/users/${username}`}
                onClick={() => setOpen(false)}
                className={NAV_LINK_CLASSES}
              >
                Profile
              </Link>
              <Link
                href="/settings/profile"
                onClick={() => setOpen(false)}
                className={NAV_LINK_CLASSES}
              >
                Settings
              </Link>
              <form action={signOutAction} className="mt-2">
                <SubmitButton
                  variant="secondary"
                  className="w-full"
                  pendingText="Signing out…"
                >
                  Sign out
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/discover"
                onClick={() => setOpen(false)}
                className={NAV_LINK_CLASSES}
              >
                Discover
              </Link>
              <Link
                href="/discover/community"
                onClick={() => setOpen(false)}
                className={NAV_LINK_CLASSES}
              >
                Community
              </Link>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className={NAV_LINK_CLASSES}
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className={cn(NAV_LINK_CLASSES, "text-primary")}
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </DrawerPopup>
    </Drawer>
  );
}
