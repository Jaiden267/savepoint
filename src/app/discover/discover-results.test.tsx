import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GameSearchResult } from "@/lib/igdb/types";

const {
  mockListDiscoverCatalogue,
  mockListDiscoverGames,
  mockGetClientIdentifier,
  FakeDiscoverCatalogueUnavailableError,
  FakeDiscoverRateLimitedError,
  FakePineconeIndexUnavailableError,
} = vi.hoisted(() => ({
  mockListDiscoverCatalogue: vi.fn(),
  mockListDiscoverGames: vi.fn(),
  mockGetClientIdentifier: vi.fn(async () => "test-client"),
  FakeDiscoverCatalogueUnavailableError: class extends Error {},
  FakeDiscoverRateLimitedError: class extends Error {},
  FakePineconeIndexUnavailableError: class extends Error {},
}));

vi.mock("@/server/services/discover-catalogue", () => ({
  listDiscoverCatalogue: mockListDiscoverCatalogue,
  DiscoverCatalogueUnavailableError: FakeDiscoverCatalogueUnavailableError,
  DiscoverRateLimitedError: FakeDiscoverRateLimitedError,
}));

vi.mock("@/server/services/game-catalogue", () => ({
  listDiscoverGames: mockListDiscoverGames,
}));

vi.mock("@/lib/pinecone/client", () => ({
  PineconeIndexUnavailableError: FakePineconeIndexUnavailableError,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));

import { DiscoverResults } from "./discover-results";

function catalogueResult(
  overrides: Partial<GameSearchResult> = {},
): GameSearchResult {
  return {
    source: "igdb",
    igdbId: 1,
    slug: "game-one",
    name: "Game One",
    coverImageId: null,
    releaseYear: 2020,
    gameType: null,
    versionParentIgdbId: null,
    ...overrides,
  };
}

function cachedGameRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "uuid-1",
    slug: "cached-game",
    name: "Cached Game",
    cover_image_id: null,
    release_date: "2018-01-01",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClientIdentifier.mockResolvedValue("test-client");
});

describe("DiscoverResults — success path", () => {
  it("renders the full-catalogue selection with no notice when not reduced", async () => {
    mockListDiscoverCatalogue.mockResolvedValue({
      results: [catalogueResult({ igdbId: 1, name: "Game One" })],
      reduced: false,
    });

    const jsx = await DiscoverResults({ seed: 42 });
    render(jsx);

    expect(screen.getByText("Game One")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mockListDiscoverGames).not.toHaveBeenCalled();
  });

  it("renders an honest reduced-results notice when the outcome is reduced, without falling back", async () => {
    mockListDiscoverCatalogue.mockResolvedValue({
      results: [catalogueResult({ igdbId: 1, name: "Only Game" })],
      reduced: true,
    });

    const jsx = await DiscoverResults({ seed: 43 });
    render(jsx);

    expect(screen.getByText("Only Game")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/fewer games/i);
    expect(mockListDiscoverGames).not.toHaveBeenCalled();
  });

  it("renders both cached and catalogue-only results from one selection", async () => {
    mockListDiscoverCatalogue.mockResolvedValue({
      results: [
        catalogueResult({ source: "local", igdbId: 1, name: "Cached One" }),
        catalogueResult({ source: "igdb", igdbId: 2, name: "Uncached Two" }),
      ],
      reduced: false,
    });

    const jsx = await DiscoverResults({ seed: 44 });
    render(jsx);

    expect(screen.getByText("Cached One")).toBeInTheDocument();
    expect(screen.getByText("Uncached Two")).toBeInTheDocument();
  });
});

describe("DiscoverResults — rate limited", () => {
  it("renders a friendly retry state, never the cached fallback", async () => {
    mockListDiscoverCatalogue.mockRejectedValue(
      new FakeDiscoverRateLimitedError(),
    );

    const jsx = await DiscoverResults({ seed: 45 });
    render(jsx);

    expect(screen.getByText("Too many requests")).toBeInTheDocument();
    expect(mockListDiscoverGames).not.toHaveBeenCalled();
  });
});

describe("DiscoverResults — genuine unavailability falls back to cached games", () => {
  it("falls back on DiscoverCatalogueUnavailableError", async () => {
    mockListDiscoverCatalogue.mockRejectedValue(
      new FakeDiscoverCatalogueUnavailableError(),
    );
    mockListDiscoverGames.mockResolvedValue({
      games: [cachedGameRow({ name: "Fallback Game" })],
      hasMore: false,
    });

    const jsx = await DiscoverResults({ seed: 46 });
    render(jsx);

    expect(mockListDiscoverGames).toHaveBeenCalledWith({ page: 1 });
    expect(screen.getByText("Fallback Game")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /temporarily unavailable/i,
    );
  });

  it("falls back on PineconeIndexUnavailableError", async () => {
    mockListDiscoverCatalogue.mockRejectedValue(
      new FakePineconeIndexUnavailableError(),
    );
    mockListDiscoverGames.mockResolvedValue({
      games: [cachedGameRow({ name: "Fallback Game Two" })],
      hasMore: false,
    });

    const jsx = await DiscoverResults({ seed: 47 });
    render(jsx);

    expect(screen.getByText("Fallback Game Two")).toBeInTheDocument();
  });

  it("renders EmptyState when even the cached fallback is empty", async () => {
    mockListDiscoverCatalogue.mockRejectedValue(
      new FakeDiscoverCatalogueUnavailableError(),
    );
    mockListDiscoverGames.mockResolvedValue({ games: [], hasMore: false });

    const jsx = await DiscoverResults({ seed: 48 });
    render(jsx);

    expect(screen.getByText("No games yet")).toBeInTheDocument();
  });

  it("re-throws an unrecognized error rather than silently falling back", async () => {
    mockListDiscoverCatalogue.mockRejectedValue(new Error("boom"));

    await expect(DiscoverResults({ seed: 49 })).rejects.toThrow("boom");
    expect(mockListDiscoverGames).not.toHaveBeenCalled();
  });
});
