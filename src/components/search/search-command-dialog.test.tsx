import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
