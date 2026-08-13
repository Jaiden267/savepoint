import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GameSearchResult } from "@/lib/igdb/types";

const { mockSearchGames, mockSearchGamesSemantic, mockGetClientIdentifier } =
  vi.hoisted(() => ({
    mockSearchGames: vi.fn(),
    mockSearchGamesSemantic: vi.fn(),
    mockGetClientIdentifier: vi.fn(async () => "test-client"),
  }));

vi.mock("@/server/services/game-catalogue", () => ({
  searchGames: mockSearchGames,
}));
vi.mock("@/server/services/semantic-search", () => ({
  searchGamesSemantic: mockSearchGamesSemantic,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));

import SearchPage from "./page";
import { SearchResults } from "./search-results";

function igdbResult(
  overrides: Partial<GameSearchResult> = {},
): GameSearchResult {
  return {
    source: "igdb",
    igdbId: 1,
    slug: "game",
    name: "Game",
    coverImageId: null,
    releaseYear: null,
    gameType: "Main Game",
    versionParentIgdbId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchGames.mockResolvedValue([]);
  mockSearchGamesSemantic.mockResolvedValue({ mode: "semantic", results: [] });
});

/**
 * Regression coverage for the "lego star war" bug: the global quick-search
 * dialog and this page's Standard mode both call the same
 * `searchGames(query)` service — but the page previously had zero test
 * coverage of what query text actually reaches that call, or which mode
 * runs by default. This locks in the query-preservation contract "Open
 * full search" depends on.
 *
 * `SearchResults` is awaited directly (exported from page.tsx for exactly
 * this reason) rather than rendering the outer `<Suspense>` boundary —
 * matching this project's established pattern (see
 * games/[slug]/page.test.tsx) for testing an async Server Component
 * without an RSC-aware test renderer.
 */
describe("SearchResults — Standard mode query handling", () => {
  it("calls searchGames with the exact trimmed query text, unmodified", async () => {
    await SearchResults({ query: "lego star war", mode: "lexical" });

    expect(mockSearchGames).toHaveBeenCalledWith("lego star war");
    expect(mockSearchGamesSemantic).not.toHaveBeenCalled();
  });

  it("renders every result searchGames returns, cached and catalogue-only alike, with no additional page-level truncation", async () => {
    mockSearchGames.mockResolvedValue([
      igdbResult({ igdbId: 1, name: "LEGO Star Wars III: The Clone Wars" }),
      igdbResult({ igdbId: 2, name: "LEGO Star Wars: The Force Awakens" }),
    ]);

    const jsx = await SearchResults({
      query: "lego star war",
      mode: "lexical",
    });
    render(jsx);

    expect(
      screen.getByText("LEGO Star Wars III: The Clone Wars"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("LEGO Star Wars: The Force Awakens"),
    ).toBeInTheDocument();
  });

  it("calls searchGamesSemantic, not searchGames, in semantic mode", async () => {
    await SearchResults({ query: "lego star war", mode: "semantic" });

    expect(mockSearchGamesSemantic).toHaveBeenCalled();
    expect(mockSearchGames).not.toHaveBeenCalled();
  });
});

describe("SearchPage — mode derivation from the URL", () => {
  it("defaults to Standard (lexical) mode when no mode param is present — matching the dialog's 'Open full search' link, which never sets one", async () => {
    const jsx = await SearchPage({
      searchParams: Promise.resolve({ q: "lego star war" }),
    });
    render(jsx);

    // The Standard tab is the active one when no ?mode= is present.
    const standardTab = screen.getByRole("link", { name: "Standard" });
    expect(standardTab).toHaveAttribute("aria-current", "page");
  });

  it("switches to Semantic mode only when mode=semantic is explicit in the URL", async () => {
    const jsx = await SearchPage({
      searchParams: Promise.resolve({ q: "lego star war", mode: "semantic" }),
    });
    render(jsx);

    const semanticTab = screen.getByRole("link", { name: "Semantic" });
    expect(semanticTab).toHaveAttribute("aria-current", "page");
  });

  it("preserves the exact query text — the 'lego star war' case — into the mode-tab links", async () => {
    const jsx = await SearchPage({
      searchParams: Promise.resolve({ q: "  lego star war  " }),
    });
    render(jsx);

    const standardTab = screen.getByRole("link", { name: "Standard" });
    expect(standardTab).toHaveAttribute("href", "/search?q=lego+star+war");
  });
});
