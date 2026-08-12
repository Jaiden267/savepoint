"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface ProfileNavProps {
  username: string;
}

const TABS = [
  { segment: "", label: "Overview" },
  { segment: "/library", label: "Library" },
  { segment: "/diary", label: "Diary" },
  { segment: "/reviews", label: "Reviews" },
  { segment: "/lists", label: "Lists" },
];

/** The one client leaf on the profile segment — usePathname() is the only reason it isn't a Server Component. */
export function ProfileNav({ username }: ProfileNavProps) {
  const pathname = usePathname();
  const base = `/users/${username}`;

  return (
    <nav
      aria-label="Profile sections"
      className="border-border scroll-fade-x mt-8 flex gap-1 overflow-x-auto border-b"
    >
      {TABS.map((tab) => {
        const href = `${base}${tab.segment}`;
        const isActive = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
