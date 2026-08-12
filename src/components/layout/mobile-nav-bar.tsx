"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, Search, LibraryBig, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Library", icon: LibraryBig },
  { href: "/diary", label: "Diary", icon: BookOpen },
] as const;

/**
 * Fixed bottom tab bar for the 5 primary signed-in destinations, shown only
 * below `md`. `data-mobile-nav-bar` is a presence marker — globals.css uses
 * a `body:has()` rule keyed on it to reserve exactly matching bottom padding
 * only on pages where this bar actually renders, so signed-out pages (which
 * never render it) get no unexplained gap.
 */
export function MobileNavBar() {
  const pathname = usePathname();

  return (
    <nav
      data-mobile-nav-bar=""
      aria-label="Primary"
      className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur md:hidden"
    >
      <div className="mx-auto flex h-14 max-w-6xl">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-0.5 w-6 rounded-full",
                  active ? "bg-primary" : "bg-transparent",
                )}
              />
              <Icon
                aria-hidden="true"
                fill={active ? "currentColor" : "none"}
                className={cn(
                  "size-5",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "leading-none",
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
      <div aria-hidden="true" className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
