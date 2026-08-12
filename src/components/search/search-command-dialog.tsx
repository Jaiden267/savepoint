"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { igdbImageUrl } from "@/lib/igdb/image-url";
import { cn } from "@/lib/utils";

interface SearchResultItem {
  source: "local" | "igdb";
  igdbId: number;
  slug: string;
  name: string;
  coverImageId: string | null;
  releaseYear: number | null;
}

const DEBOUNCE_MS = 250;

/**
 * Global ⌘K/Ctrl+K search dialog. Base UI's Dialog handles open/close,
 * focus trapping, Escape-to-close and focus-return-to-trigger; the
 * combobox/listbox ARIA wiring below (role="combobox", aria-expanded,
 * aria-controls, aria-activedescendant on the input; role="listbox"/"option"
 * on the results) is layered on top by hand, since Dialog alone doesn't
 * provide it. Options are plain divs, not buttons — deliberately not
 * independently tabbable, so focus stays on the input and arrow keys move
 * only the virtual aria-activedescendant pointer, per the standard
 * editable-combobox-with-listbox pattern.
 */
export function SearchCommandDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const listboxId = useId();

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Reset state directly in the open-change handler (a real user-event
  // callback), not in an effect watching `open` — synchronous setState at
  // the top of an effect body is flagged by react-hooks/set-state-in-effect
  // even though it's a legitimate cleanup-on-close here.
  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setResults([]);
      setActiveIndex(-1);
      setLoading(false);
    }
  }

  const runSearch = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(value)}`)
        .then((response) => response.json())
        .then((data: { results?: SearchResultItem[] }) => {
          setResults(data.results ?? []);
          setActiveIndex(-1);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
  }, []);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setQuery(value);
    runSearch(value);
  }

  function navigateTo(slug: string) {
    setOpen(false);
    router.push(`/games/${slug}`);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = results[activeIndex] ?? results[0];
      if (active) navigateTo(active.slug);
    }
    // Escape is intentionally left unhandled here — Base UI's Dialog
    // closes on Escape by default.
  }

  const activeOptionId =
    activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        aria-label="Search games"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "gap-1.5",
        )}
      >
        <SearchIcon aria-hidden="true" />
        <span className="hidden sm:inline" aria-hidden="true">
          Search games
        </span>
        <kbd className="text-muted-foreground ml-1 hidden text-xs sm:inline">
          ⌘K
        </kbd>
      </DialogTrigger>
      <DialogPopup className="max-w-xl" initialFocus={inputRef}>
        <DialogTitle className="sr-only">Search games</DialogTitle>
        <DialogDescription className="sr-only">
          Search the Savepoint game catalogue by title
        </DialogDescription>
        <div className="border-border/60 flex items-center gap-2 border-b pb-3">
          <SearchIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-label="Search games"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder="Search games..."
            autoComplete="off"
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="mt-2 max-h-80 overflow-y-auto"
        >
          {loading ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">
              Searching…
            </p>
          ) : results.length === 0 && query.trim() ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">
              No games found.
            </p>
          ) : (
            results.map((result, index) => (
              <div
                key={`${result.source}-${result.igdbId}`}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => navigateTo(result.slug)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm",
                  index === activeIndex ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="bg-muted relative aspect-[3/4] w-8 shrink-0 overflow-hidden rounded">
                  {result.coverImageId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tiny, ephemeral list thumbnail; next/image's overhead isn't worth it here
                    <img
                      src={igdbImageUrl(result.coverImageId, "thumb")}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : null}
                </span>
                <span className="flex-1 truncate">{result.name}</span>
                {result.releaseYear ? (
                  <span className="text-muted-foreground text-xs">
                    {result.releaseYear}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
        <div className="border-border/60 mt-2 border-t pt-2">
          <Link
            href={
              query.trim()
                ? `/search?q=${encodeURIComponent(query.trim())}`
                : "/search"
            }
            onClick={() => handleOpenChange(false)}
            className="hover:bg-muted/60 flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <SearchIcon
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
              Open full search
            </span>
            <span className="text-muted-foreground text-xs">
              Standard &amp; Semantic
            </span>
          </Link>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
