import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchCommandDialog } from "./search-command-dialog";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFetch = vi.fn();

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockPush.mockReset();
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
