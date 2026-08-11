"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { SearchIcon, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  addListItemAction,
  type AddListItemResult,
} from "@/server/actions/lists";
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

interface AddGameToListDialogProps {
  listId: string;
  onAdded: (item: NonNullable<AddListItemResult["item"]>) => void;
}

/**
 * A list-scoped variant of search-command-dialog.tsx's combobox/listbox
 * pattern (same Base UI Dialog + hand-wired ARIA semantics) — reuses the
 * same `/api/search` endpoint for the search UX, but calls
 * `addListItemAction` on selection instead of navigating.
 */
export function AddGameToListDialog({
  listId,
  onAdded,
}: AddGameToListDialogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [addingIgdbId, setAddingIgdbId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setResults([]);
      setActiveIndex(-1);
      setLoading(false);
      setError(null);
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

  async function handleSelect(result: SearchResultItem) {
    setError(null);
    setAddingIgdbId(result.igdbId);
    const outcome = await addListItemAction(listId, result.igdbId);
    setAddingIgdbId(null);
    if (outcome.status === "success" && outcome.item) {
      onAdded(outcome.item);
      setResults((prev) => prev.filter((r) => r.igdbId !== result.igdbId));
    } else {
      setError(outcome.message ?? "Couldn't add that game. Please try again.");
    }
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
      if (active) void handleSelect(active);
    }
  }

  const activeOptionId =
    activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "gap-1.5",
        )}
      >
        <SearchIcon aria-hidden="true" />
        Add game
      </DialogTrigger>
      <DialogPopup className="max-w-xl" initialFocus={inputRef}>
        <DialogTitle className="sr-only">Add a game to this list</DialogTitle>
        <DialogDescription className="sr-only">
          Search the Savepoint game catalogue to add a game to this list
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
            aria-label="Search games to add"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder="Search games…"
            autoComplete="off"
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        {error ? (
          <p className="text-destructive mt-2 text-xs" role="alert">
            {error}
          </p>
        ) : null}
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
                aria-disabled={addingIgdbId === result.igdbId}
                onClick={() => void handleSelect(result)}
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
                {addingIgdbId === result.igdbId ? (
                  <Loader2
                    className="text-muted-foreground size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
