import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  mockGetOrImportGameBySlug,
  mockGetGameSocialData,
  mockGetUser,
  mockGetClientIdentifier,
} = vi.hoisted(() => ({
  mockGetOrImportGameBySlug: vi.fn(),
  mockGetGameSocialData: vi.fn(),
  mockGetUser: vi.fn(),
  mockGetClientIdentifier: vi.fn(async () => "test-client"),
}));

vi.mock("@/server/services/game-sync", () => ({
  getOrImportGameBySlug: mockGetOrImportGameBySlug,
  GameImportRateLimitedError: class GameImportRateLimitedError extends Error {},
}));
vi.mock("@/server/services/game-social", () => ({
  getGameSocialData: mockGetGameSocialData,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: [] })),
        })),
      })),
    }),
  ),
}));
vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));

// GameHero/GameMetadata/GameActionPanel need detailed IGDB-shaped props not
// relevant to what regressed — stubbed so this test can focus on the review
// section, which is exactly where the Server/Client boundary crash lived.
vi.mock("@/components/games/game-hero", () => ({
  GameHero: () => <div data-testid="game-hero" />,
}));
vi.mock("@/components/games/game-metadata", () => ({
  GameMetadata: () => <div data-testid="game-metadata" />,
}));
vi.mock("@/components/games/game-action-panel", () => ({
  GameActionPanel: (props: { signedIn: boolean }) => (
    <div data-testid="game-action-panel">
      {props.signedIn ? "signed-in" : "signed-out"}
    </div>
  ),
}));

import GamePage from "./page";

const game = {
  id: "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58",
  slug: "the-legend-of-zelda-breath-of-the-wild",
  name: "The Legend of Zelda: Breath of the Wild",
};

function baseSocial(overrides: Record<string, unknown> = {}) {
  return {
    userGame: null,
    recentDiaryEntries: [],
    ownReview: null,
    ratingStats: { averageStars: null, ratingCount: 0 },
    recentReviews: [],
    ...overrides,
  };
}

async function renderGamePage() {
  const jsx = await GamePage({
    params: Promise.resolve({ slug: game.slug }),
  });
  return render(jsx);
}

/**
 * Regression coverage for the RSC boundary crash ("Attempted to call
 * starGlyphs() from the server but starGlyphs is on the client"): it only
 * fired once the game page actually reached the "own review present"
 * branch, which is why the bug was state-dependent — a brand-new game page
 * (no review yet) never called the offending function. These tests render
 * the real page across every state the bug could hide in. Note: Vitest
 * does not enforce the "use client" module boundary the way Next's actual
 * build does, so these tests verify correct data-driven composition, not
 * the boundary itself — see rating.test.ts / own-review-card.test.tsx for
 * the source-level fix, and the standalone smoke test for the one check
 * that exercises Next's real RSC compilation.
 */
describe("GamePage — review section across every ownReview/recentReviews state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrImportGameBySlug.mockResolvedValue(game);
    mockGetClientIdentifier.mockResolvedValue("test-client");
  });

  it("renders successfully with no reviews at all (signed-out)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGetGameSocialData.mockResolvedValue(baseSocial());

    await renderGamePage();

    expect(screen.getByTestId("game-hero")).toBeInTheDocument();
    expect(screen.queryByText("Your review")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent reviews")).not.toBeInTheDocument();
  });

  it("renders another user's review under Recent reviews, with no Your review section, for a signed-in non-owner viewer", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "viewer-1" } } });
    mockGetGameSocialData.mockResolvedValue(
      baseSocial({
        recentReviews: [
          {
            review: {
              id: "review-1",
              rating: 4,
              body: "Great game.",
              hasSpoilers: false,
              createdAt: "2026-01-01T00:00:00Z",
              gameSlug: game.slug,
            },
            author: {
              username: "otheruser",
              displayName: null,
              avatarUrl: null,
            },
            likeCount: 2,
            viewerHasLiked: false,
          },
        ],
      }),
    );

    await renderGamePage();

    expect(screen.getByText("Recent reviews")).toBeInTheDocument();
    expect(screen.getByText("Great game.")).toBeInTheDocument();
    expect(screen.queryByText("Your review")).not.toBeInTheDocument();
  });

  it("renders the signed-in viewer's own review in a separate Your review section — the exact state that crashed before the fix", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mockGetGameSocialData.mockResolvedValue(
      baseSocial({
        ownReview: {
          id: "own-review-1",
          rating: 4.5,
          body: "My own thoughts.",
          hasSpoilers: false,
        },
      }),
    );

    await renderGamePage();

    expect(screen.getByText("Your review")).toBeInTheDocument();
    expect(screen.getByText("My own thoughts.")).toBeInTheDocument();
    expect(screen.queryByText("Recent reviews")).not.toBeInTheDocument();
  });

  it("renders correctly across a review being created and then deleted", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });

    mockGetGameSocialData.mockResolvedValueOnce(
      baseSocial({
        ownReview: {
          id: "own-review-1",
          rating: 3,
          body: "Draft thoughts.",
          hasSpoilers: false,
        },
      }),
    );
    const { unmount } = await renderGamePage();
    expect(screen.getByText("Your review")).toBeInTheDocument();
    unmount();

    mockGetGameSocialData.mockResolvedValueOnce(baseSocial());
    await renderGamePage();
    expect(screen.queryByText("Your review")).not.toBeInTheDocument();
  });

  it("renders successfully for a signed-out viewer even when other users' reviews exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGetGameSocialData.mockResolvedValue(
      baseSocial({
        recentReviews: [
          {
            review: {
              id: "review-1",
              rating: 3,
              body: "Signed-out visible review.",
              hasSpoilers: false,
              createdAt: "2026-01-01T00:00:00Z",
              gameSlug: game.slug,
            },
            author: { username: "someone", displayName: null, avatarUrl: null },
            likeCount: 0,
            viewerHasLiked: false,
          },
        ],
      }),
    );

    await renderGamePage();

    expect(screen.getByTestId("game-action-panel")).toHaveTextContent(
      "signed-out",
    );
    expect(screen.getByText("Signed-out visible review.")).toBeInTheDocument();
  });
});
