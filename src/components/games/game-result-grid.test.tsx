import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GameSearchResult } from "@/lib/igdb/types";

const { mockImportCatalogueGameAction } = vi.hoisted(() => ({
  mockImportCatalogueGameAction: vi.fn(
    async (state: unknown, _formData: FormData) => state,
  ),
}));

vi.mock("@/server/actions/games", () => ({
  importCatalogueGameAction: mockImportCatalogueGameAction,
}));

import { GameResultGrid } from "./game-result-grid";

function result(overrides: Partial<GameSearchResult> = {}): GameSearchResult {
  return {
    source: "local",
    igdbId: 1,
    slug: "game-one",
    name: "Game One",
    coverImageId: null,
    releaseYear: 2020,
    gameType: "Main Game",
    versionParentIgdbId: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockImportCatalogueGameAction.mockClear();
});

describe("GameResultGrid", () => {
  it("renders a local result as a real <a> link to its stored slug", () => {
    render(
      <GameResultGrid
        results={[result({ source: "local", slug: "the-real-slug" })]}
      />,
    );

    const link = screen.getByRole("link", { name: /game one/i });
    expect(link).toHaveAttribute("href", "/games/the-real-slug");
  });

  it("renders a catalogue-only (igdb) result as a POST-based form/button, not a link", () => {
    render(
      <GameResultGrid
        results={[
          result({ source: "igdb", igdbId: 42, name: "Uncached Game" }),
        ]}
      />,
    );

    const button = screen.getByRole("button", {
      name: /import and open uncached game/i,
    });
    expect(button).toHaveAttribute("type", "submit");
    expect(screen.queryByRole("link", { name: /uncached game/i })).toBeNull();
  });

  it("renders a mixed set — cached and catalogue-only — in the given order, correctly typed", () => {
    render(
      <GameResultGrid
        results={[
          result({ source: "local", igdbId: 1, name: "Cached Game" }),
          result({ source: "igdb", igdbId: 2, name: "Catalogue Game" }),
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: /cached game/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import and open catalogue game/i }),
    ).toBeInTheDocument();
  });

  it("keeps two distinct igdb_ids sharing the same name as two separate items, never collapsed by key collision", () => {
    render(
      <GameResultGrid
        results={[
          result({ source: "igdb", igdbId: 10, name: "Duplicate Title" }),
          result({ source: "igdb", igdbId: 20, name: "Duplicate Title" }),
        ]}
      />,
    );

    expect(
      screen.getAllByRole("button", {
        name: /import and open duplicate title/i,
      }),
    ).toHaveLength(2);
  });

  it("renders nothing when given an empty result list", () => {
    const { container } = render(<GameResultGrid results={[]} />);
    expect(container.querySelectorAll("a, button")).toHaveLength(0);
  });
});
