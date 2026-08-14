import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RecommendationResult } from "@/server/services/recommendations";

const {
  mockGetRecommendations,
  mockRequireUser,
  mockGetClientIdentifier,
  mockGenresSelect,
  FakeRecommendationsRateLimitedError,
  FakeRecommendationsUnavailableError,
  FakePineconeIndexUnavailableError,
  FakePineconeSearchError,
} = vi.hoisted(() => ({
  mockGetRecommendations: vi.fn(),
  mockRequireUser: vi.fn(async () => ({ id: "user-1" })),
  mockGetClientIdentifier: vi.fn(async () => "test-client"),
  mockGenresSelect: vi.fn(),
  FakeRecommendationsRateLimitedError: class extends Error {},
  FakeRecommendationsUnavailableError: class extends Error {},
  FakePineconeIndexUnavailableError: class extends Error {},
  FakePineconeSearchError: class extends Error {},
}));

vi.mock("@/server/services/recommendations", () => ({
  getRecommendations: mockGetRecommendations,
  RecommendationsRateLimitedError: FakeRecommendationsRateLimitedError,
  RecommendationsUnavailableError: FakeRecommendationsUnavailableError,
}));

vi.mock("@/lib/pinecone/client", () => ({
  PineconeIndexUnavailableError: FakePineconeIndexUnavailableError,
}));

vi.mock("@/lib/pinecone/search", () => ({
  PineconeSearchError: FakePineconeSearchError,
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: mockRequireUser,
}));

vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn() },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: mockGenresSelect,
          })),
        })),
      })),
    }),
  ),
}));

import { RecommendationsResults } from "./recommendations-results";

function makeResult(
  igdbId: number,
  overrides: Partial<RecommendationResult> = {},
): RecommendationResult {
  return {
    source: "local",
    igdbId,
    slug: `game-${igdbId}`,
    name: `Game ${igdbId}`,
    coverImageId: null,
    releaseYear: 2020,
    gameType: null,
    versionParentIgdbId: null,
    reason: "Matches your preference for RPG",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ id: "user-1" });
  mockGetClientIdentifier.mockResolvedValue("test-client");
  mockGenresSelect.mockResolvedValue({ data: [] });
});

describe("RecommendationsResults — success path", () => {
  it("renders personalized results with no notices", async () => {
    mockGetRecommendations.mockResolvedValue({
      results: [makeResult(1, { name: "Game One" })],
      mode: "personalized",
      reduced: false,
      coldStart: false,
    });

    const jsx = await RecommendationsResults({ seed: 1 });
    render(jsx);

    expect(screen.getByText("Game One")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the preference-assisted notice distinctly from real personalization", async () => {
    mockGetRecommendations.mockResolvedValue({
      results: [makeResult(2, { name: "Hint Game" })],
      mode: "preference-assisted",
      reduced: false,
      coldStart: false,
    });

    const jsx = await RecommendationsResults({ seed: 2, genreHints: ["rpg"] });
    render(jsx);

    expect(screen.getByRole("status")).toHaveTextContent(
      /preference-assisted discovery/i,
    );
    expect(mockGetRecommendations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        seed: 2,
        genreHints: ["rpg"],
      }),
    );
  });

  it("renders a reduced-results notice without falling back", async () => {
    mockGetRecommendations.mockResolvedValue({
      results: [makeResult(3, { name: "Only Game" })],
      mode: "personalized",
      reduced: true,
      coldStart: false,
    });

    const jsx = await RecommendationsResults({ seed: 3 });
    render(jsx);

    expect(screen.getByText("Only Game")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/fewer/i);
  });
});

describe("RecommendationsResults — cold start", () => {
  it("renders ColdStartView with the fetched genres, never fabricating personalization", async () => {
    mockGetRecommendations.mockResolvedValue({
      results: [],
      mode: "personalized",
      reduced: false,
      coldStart: true,
    });
    mockGenresSelect.mockResolvedValue({
      data: [{ slug: "rpg", name: "RPG" }],
    });

    const jsx = await RecommendationsResults({ seed: 4 });
    render(jsx);

    expect(
      screen.getByText(/rate a few games to get personalized recommendations/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RPG" })).toBeInTheDocument();
  });

  it("renders ColdStartView gracefully when the genres query returns null data", async () => {
    mockGetRecommendations.mockResolvedValue({
      results: [],
      mode: "personalized",
      reduced: false,
      coldStart: true,
    });
    mockGenresSelect.mockResolvedValue({ data: null });

    const jsx = await RecommendationsResults({ seed: 5 });
    render(jsx);

    expect(
      screen.getByText(/rate a few games to get personalized recommendations/i),
    ).toBeInTheDocument();
  });
});

describe("RecommendationsResults — rate limited", () => {
  it("renders a friendly retry state, never the fallback CTA", async () => {
    mockGetRecommendations.mockRejectedValue(
      new FakeRecommendationsRateLimitedError(),
    );

    const jsx = await RecommendationsResults({ seed: 6 });
    render(jsx);

    expect(screen.getByText("Too many requests")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /browse discover/i }),
    ).not.toBeInTheDocument();
  });
});

describe("RecommendationsResults — genuine unavailability", () => {
  it.each([
    ["RecommendationsUnavailableError", FakeRecommendationsUnavailableError],
    ["PineconeIndexUnavailableError", FakePineconeIndexUnavailableError],
    ["PineconeSearchError", FakePineconeSearchError],
  ])("falls back to the Discover CTA on %s", async (_label, ErrorClass) => {
    mockGetRecommendations.mockRejectedValue(new ErrorClass());

    const jsx = await RecommendationsResults({ seed: 7 });
    render(jsx);

    expect(
      screen.getByText("Recommendations are temporarily unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /browse discover/i }),
    ).toHaveAttribute("href", "/discover");
  });

  it("re-throws an unrecognized error rather than silently falling back", async () => {
    mockGetRecommendations.mockRejectedValue(new Error("boom"));

    await expect(RecommendationsResults({ seed: 8 })).rejects.toThrow("boom");
  });
});

describe("RecommendationsResults — identity", () => {
  it("always derives userId from requireUser's session, never from a client-supplied param", async () => {
    mockGetRecommendations.mockResolvedValue({
      results: [],
      mode: "personalized",
      reduced: false,
      coldStart: false,
    });

    await RecommendationsResults({ seed: 9 });

    expect(mockRequireUser).toHaveBeenCalledTimes(1);
    expect(mockGetRecommendations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-1" }),
    );
  });
});
