"use client";

import { useRef } from "react";
import type { LibrarySort } from "@/server/services/library";

const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "rating_desc", label: "Highest rated" },
  { value: "alpha", label: "Title A–Z" },
];

/** GET-form sort control for /library — auto-submits on change, preserving `status` via a hidden field so the current tab stays selected. */
export function SortSelect({
  status,
  sort,
}: {
  status: string | null;
  sort: LibrarySort;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} method="GET" action="/library">
      {status ? <input type="hidden" name="status" value={status} /> : null}
      <label className="sr-only" htmlFor="library-sort">
        Sort library
      </label>
      <select
        id="library-sort"
        name="sort"
        defaultValue={sort}
        onChange={() => formRef.current?.requestSubmit()}
        className="border-border bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </form>
  );
}
