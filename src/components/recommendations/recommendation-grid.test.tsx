import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";
import type { RecommendationResult } from "@/server/services/recommendations";

const { mockRecordRecommendationImpressionsAction, mockToggle } = vi.hoisted(
  () => ({
    mockRecordRecommendationImpressionsAction: vi.fn(),
    mockToggle: vi.fn(),
  }),
);

vi.mock("@/server/actions/recommendations", () => ({
  recordRecommendationImpressionsAction:
    mockRecordRecommendationImpressionsAction,
  toggleRecommendationFeedbackAction: mockToggle,
  importRecommendedCatalogueGameAction: vi.fn(),
}));

import { RecommendationGrid } from "./recommendation-grid";

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
    reason: `Matches your preference for tag ${igdbId}`,
    ...overrides,
  };
}

beforeEach(() => {
  mockRecordRecommendationImpressionsAction.mockReset();
  mockRecordRecommendationImpressionsAction.mockResolvedValue(undefined);
});

describe("RecommendationGrid", () => {
  it("renders one card per result, in the given order", () => {
    render(
      <RecommendationGrid
        results={[makeResult(1), makeResult(2), makeResult(3)]}
      />,
    );
    expect(screen.getByText("Game 1")).toBeInTheDocument();
    expect(screen.getByText("Game 2")).toBeInTheDocument();
    expect(screen.getByText("Game 3")).toBeInTheDocument();
  });

  it("fires the impression tracker with every result's igdbId", () => {
    render(<RecommendationGrid results={[makeResult(10), makeResult(20)]} />);
    expect(mockRecordRecommendationImpressionsAction).toHaveBeenCalledWith([
      10, 20,
    ]);
  });

  it("renders both cached and catalogue-only results correctly in the same grid", () => {
    render(
      <RecommendationGrid
        results={[
          makeResult(1, { source: "local" }),
          makeResult(2, { source: "igdb", name: "Catalogue Game" }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /game 1/i })).toHaveAttribute(
      "href",
      "/games/game-1",
    );
    expect(
      screen.getByRole("button", { name: /import and open catalogue game/i }),
    ).toBeInTheDocument();
  });

  it("renders an empty grid without error when there are no results", () => {
    const { container } = render(<RecommendationGrid results={[]} />);
    expect(container.querySelectorAll("a, button")).toHaveLength(0);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <RecommendationGrid results={[makeResult(1), makeResult(2)]} />,
    );
    expectNoAxeViolations(await axe(container));
  });
});
