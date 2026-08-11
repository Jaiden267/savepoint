import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/games/status-selector", () => ({
  StatusSelector: (props: { currentStatus: string | null }) => (
    <div data-testid="status-selector">{props.currentStatus ?? "none"}</div>
  ),
}));
vi.mock("@/components/games/rating-control", () => ({
  RatingControl: (props: { inLibrary: boolean }) => (
    <div data-testid="rating-control">{String(props.inLibrary)}</div>
  ),
}));
vi.mock("@/components/games/log-diary-entry-dialog", () => ({
  LogDiaryEntryDialog: (props: { triggerLabel: string }) => (
    <div data-testid="log-diary-entry-dialog">{props.triggerLabel}</div>
  ),
}));
vi.mock("@/components/reviews/review-composer", () => ({
  ReviewComposer: (props: { existingReview: unknown }) => (
    <div data-testid="review-composer">
      {props.existingReview ? "edit" : "write"}
    </div>
  ),
}));

import { GameActionPanel } from "./game-action-panel";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const gameSlug = "the-legend-of-zelda";

describe("GameActionPanel", () => {
  it("shows only a sign-in prompt for signed-out viewers — no tracking panel at all", () => {
    render(
      <GameActionPanel
        gameId={gameId}
        gameSlug={gameSlug}
        signedIn={false}
        userGame={null}
        existingReview={null}
      />,
    );

    expect(screen.getByText(/track this game/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?next=/games/${gameSlug}`,
    );
    expect(screen.queryByTestId("status-selector")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rating-control")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("log-diary-entry-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-composer")).not.toBeInTheDocument();
  });

  it("renders the full tracking panel for signed-in viewers, with diary/review entry points enabled even without a library status", () => {
    render(
      <GameActionPanel
        gameId={gameId}
        gameSlug={gameSlug}
        signedIn
        userGame={null}
        existingReview={null}
      />,
    );

    expect(screen.getByTestId("status-selector")).toBeInTheDocument();
    expect(screen.getByTestId("rating-control")).toHaveTextContent("false");
    expect(screen.getByTestId("log-diary-entry-dialog")).toHaveTextContent(
      "Log play",
    );
    expect(screen.getByTestId("review-composer")).toHaveTextContent("write");
  });

  it("passes library/rating/review state through to the child controls", () => {
    render(
      <GameActionPanel
        gameId={gameId}
        gameSlug={gameSlug}
        signedIn
        userGame={{ status: "playing", rating: 4 }}
        existingReview={{
          id: "review-1",
          rating: 4,
          body: "text",
          hasSpoilers: false,
        }}
      />,
    );

    expect(screen.getByTestId("status-selector")).toHaveTextContent("playing");
    expect(screen.getByTestId("rating-control")).toHaveTextContent("true");
    expect(screen.getByTestId("review-composer")).toHaveTextContent("edit");
  });
});
