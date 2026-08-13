import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchCommandDialog } from "./search-command-dialog";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const { mockImportCatalogueGameAction } = vi.hoisted(() => ({
  mockImportCatalogueGameAction: vi.fn(
    async (state: unknown, _formData: FormData) => state,
  ),
}));

vi.mock("@/server/actions/games", () => ({
  importCatalogueGameAction: mockImportCatalogueGameAction,
}));

const mockFetch = vi.fn();

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockPush.mockReset();
  mockImportCatalogueGameAction.mockClear();
  mockFetch.mockResolvedValue(
    jsonResponse({
      results: [
        {
          source: "local",
          igdbId: 1,
          slug: "game-one",
          name: "Game One",
          coverImageId: null,
          releaseYear: 2020,
        },
        {
          source: "igdb",
          igdbId: 2,
          slug: "game-two",
          name: "Game Two",
          coverImageId: null,
          releaseYear: 2021,
        },
      ],
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /search games/i }));
}

/**
 * Regression coverage for the accessibility requirement layered on top of
 * Base UI's Dialog: real combobox/listbox ARIA semantics (not just a
 * styled input + list), correct focus/activedescendant wiring, and
 * keyboard navigation (ArrowDown/Enter/Escape).
 */
describe("SearchCommandDialog", () => {
  it("exposes combobox/listbox ARIA semantics once opened", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);

    await openDialog(user);

    const input = screen.getByRole("combobox", { name: "Search games" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-controls");
    expect(
      screen.getByRole("listbox", { name: "Search results" }),
    ).toBeInTheDocument();
  });

  it("shows debounced results as labelled options", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "zelda");

    expect(
      await screen.findByRole("option", { name: /Game One/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Game Two/i }),
    ).toBeInTheDocument();
  });

  it("moves aria-activedescendant on ArrowDown and navigates to the active option on Enter", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    const input = screen.getByRole("combobox");
    await user.type(input, "zelda");
    await screen.findByRole("option", { name: /Game One/i });

    await user.keyboard("{ArrowDown}");
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    const activeOption = document.getElementById(activeId ?? "");
    expect(activeOption).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledWith("/games/game-one");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    expect(screen.getByRole("combobox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

/**
 * Regression coverage for the "Open full search" handoff — the only route
 * from this quick-jump dialog to the full /search page (Standard/Semantic
 * mode toggle lives there). Must be a real, keyboard-reachable link (not a
 * mouse-only affordance), must preserve whatever the user already typed,
 * and must close this dialog on navigation so it doesn't linger open over
 * /search (the same class of bug the mobile nav drawer had before it was
 * fixed to close on link click).
 */
describe("SearchCommandDialog — Open full search handoff", () => {
  it("links to plain /search when no query has been entered", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    const link = screen.getByRole("link", { name: /open full search/i });
    expect(link).toHaveAttribute("href", "/search");
  });

  it("preserves the entered query in the link's href", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "zelda");

    const link = screen.getByRole("link", { name: /open full search/i });
    expect(link).toHaveAttribute("href", "/search?q=zelda");
  });

  it("preserves a multi-word query exactly, spaces and all — the 'lego star war' case, so full Standard search receives the identical text the quick-search results were based on", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "lego star war");

    const link = screen.getByRole("link", { name: /open full search/i });
    expect(link).toHaveAttribute("href", "/search?q=lego%20star%20war");
    // Decoding the preserved query must round-trip to the exact original
    // text, with no mode param forcing anything other than Standard.
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.searchParams.get("q")).toBe("lego star war");
    expect(url.searchParams.get("mode")).toBeNull();
  });

  it("URL-encodes a query containing special characters", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "cat & mouse");

    const link = screen.getByRole("link", { name: /open full search/i });
    expect(link).toHaveAttribute("href", "/search?q=cat%20%26%20mouse");
  });

  it("trims a whitespace-only query down to plain /search", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "   ");

    const link = screen.getByRole("link", { name: /open full search/i });
    expect(link).toHaveAttribute("href", "/search");
  });

  it("is reachable via Tab from the search input (keyboard-accessible, not mouse-only)", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    // Base UI defers the initial-focus move a tick past the click handler
    // (same class of async focus timing already handled with waitFor in
    // drawer.test.tsx) — wait for it rather than asserting synchronously.
    const input = screen.getByRole("combobox");
    await waitFor(() => {
      expect(input).toHaveFocus();
    });

    await user.tab();

    expect(
      screen.getByRole("link", { name: /open full search/i }),
    ).toHaveFocus();
  });

  it("mentions both search modes in its accessible name, so Semantic search is discoverable from the dialog", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    const link = screen.getByRole("link", { name: /open full search/i });
    expect(link).toHaveAccessibleName(/standard.*semantic/i);
  });

  it("closes the dialog when the link is activated, instead of lingering open over /search", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    expect(screen.getByRole("combobox")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /open full search/i }));

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("still lets Enter jump straight to the active result — the quick-search path is unchanged", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "zelda");
    await screen.findByRole("option", { name: /Game One/i });

    await user.keyboard("{Enter}");

    expect(mockPush).toHaveBeenCalledWith("/games/game-one");
  });
});

/**
 * Regression coverage for the real defect this dialog shipped with: an
 * uncached ("igdb"-source) result was navigated to via a client-guessed
 * `/games/<slug>` URL built from the live IGDB search response — which
 * 404s whenever that game has never been imported into Supabase (e.g. the
 * exact "Thor: God of Thunder" case, where a second, distinct IGDB game
 * with the same title carried IGDB's own duplicate-name collision slug
 * suffix, `thor-god-of-thunder--1`). Cached ("local") results carry a
 * real, already-stored slug and must keep navigating directly; uncached
 * results must go through the same POST-based import boundary the
 * Pinecone catalogue-only results use, never a presumed URL.
 */
describe("SearchCommandDialog — cached vs. catalogue-only result activation", () => {
  it("navigates a cached (local) result directly by its stored slug", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "game");
    await user.click(await screen.findByRole("option", { name: /Game One/i }));

    expect(mockPush).toHaveBeenCalledWith("/games/game-one");
    expect(mockImportCatalogueGameAction).not.toHaveBeenCalled();
  });

  it("routes an uncached (igdb) result through the POST import action instead of a presumed URL — click", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "game");
    await user.click(await screen.findByRole("option", { name: /Game Two/i }));

    expect(mockImportCatalogueGameAction).toHaveBeenCalled();
    const formData = mockImportCatalogueGameAction.mock
      .calls[0]?.[1] as FormData;
    expect(formData.get("igdbId")).toBe("2");
    // Never a client-guessed `/games/<slug>` push for an uncached result.
    expect(mockPush).not.toHaveBeenCalledWith("/games/game-two");
  });

  it("routes an uncached (igdb) result through the POST import action instead of a presumed URL — keyboard", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    const input = screen.getByRole("combobox");
    await user.type(input, "game");
    await screen.findByRole("option", { name: /Game Two/i });

    // ArrowDown twice: index -1 -> 0 (Game One) -> 1 (Game Two).
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(mockImportCatalogueGameAction).toHaveBeenCalled();
    const formData = mockImportCatalogueGameAction.mock
      .calls[0]?.[1] as FormData;
    expect(formData.get("igdbId")).toBe("2");
    expect(mockPush).not.toHaveBeenCalledWith("/games/game-two");
  });

  it("closes the dialog immediately when an uncached result is activated", async () => {
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "game");
    await user.click(await screen.findByRole("option", { name: /Game Two/i }));

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("never constructs a game URL from the displayed title/slug for an uncached result, even one shaped like the live Thor: God of Thunder bug", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        results: [
          {
            source: "local",
            igdbId: 5219,
            slug: "thor-god-of-thunder",
            name: "Thor: God of Thunder",
            coverImageId: null,
            releaseYear: 2011,
          },
          {
            source: "igdb",
            igdbId: 314293,
            slug: "thor-god-of-thunder--1",
            name: "Thor: God of Thunder",
            coverImageId: null,
            releaseYear: 2011,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<SearchCommandDialog />);
    await openDialog(user);

    await user.type(screen.getByRole("combobox"), "thor");
    const firstPassOptions = await screen.findAllByRole("option", {
      name: /Thor: God of Thunder/i,
    });
    expect(firstPassOptions).toHaveLength(2);

    // The first (cached) occurrence navigates directly by its real slug.
    // Activating any result closes the dialog, same as real usage.
    await user.click(firstPassOptions[0]);
    expect(mockPush).toHaveBeenCalledWith("/games/thor-god-of-thunder");
    expect(mockImportCatalogueGameAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    mockPush.mockClear();

    // Reopen and activate the second (uncached) occurrence — carrying
    // IGDB's own double-hyphen duplicate-name slug. It must never be
    // pushed to directly; it goes through the import action, keyed by
    // igdb_id, never the slug/title.
    await openDialog(user);
    await user.type(screen.getByRole("combobox"), "thor");
    const secondPassOptions = await screen.findAllByRole("option", {
      name: /Thor: God of Thunder/i,
    });
    expect(secondPassOptions).toHaveLength(2);

    await user.click(secondPassOptions[1]);
    expect(mockImportCatalogueGameAction).toHaveBeenCalled();
    const formData = mockImportCatalogueGameAction.mock
      .calls[0]?.[1] as FormData;
    expect(formData.get("igdbId")).toBe("314293");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
