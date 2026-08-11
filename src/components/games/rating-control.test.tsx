import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockRateGameAction, mockClearRatingAction } = vi.hoisted(() => ({
  mockRateGameAction: vi.fn(
    async (state: unknown, _formData: FormData) => state,
  ),
  mockClearRatingAction: vi.fn(async () => ({
    status: "success" as const,
    message: "Rating cleared.",
  })),
}));

vi.mock("@/server/actions/library", () => ({
  rateGameAction: mockRateGameAction,
  clearRatingAction: mockClearRatingAction,
  setGameStatusAction: vi.fn(),
  removeFromLibraryAction: vi.fn(),
}));

import { RatingControl } from "./rating-control";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const gameSlug = "the-legend-of-zelda";

describe("RatingControl", () => {
  beforeEach(() => {
    mockRateGameAction.mockClear();
    mockClearRatingAction.mockClear();
  });

  it("submits rateGameAction with the clicked star value", async () => {
    const user = userEvent.setup();
    render(
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={null}
        inLibrary
      />,
    );

    await user.click(screen.getByLabelText("3.5 stars"));

    await waitFor(() => {
      expect(mockRateGameAction).toHaveBeenCalled();
    });
    const [, formData] = mockRateGameAction.mock.calls[0] as [
      unknown,
      FormData,
    ];
    expect(formData.get("stars")).toBe("3.5");
    expect(formData.get("gameId")).toBe(gameId);
  });

  it("disables Clear when there is no current rating", () => {
    render(
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={null}
        inLibrary
      />,
    );

    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("enables Clear once a rating exists", () => {
    render(
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={3.5}
        inLibrary
      />,
    );

    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
  });

  it("disables the whole rating fieldset (and Clear) when not in the library", () => {
    render(
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={null}
        inLibrary={false}
      />,
    );

    expect(screen.getByLabelText("5 stars")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(
      screen.getByText(/add this game to your library to rate it/i),
    ).toBeInTheDocument();
  });

  it("submits clearRatingAction when Clear is clicked", async () => {
    const user = userEvent.setup();
    render(
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={4}
        inLibrary
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(mockClearRatingAction).toHaveBeenCalled();
    });
  });

  it("disables the rating fieldset and Clear while a rate submission is pending", async () => {
    let resolveAction!: (value: { status: "success"; message: string }) => void;
    mockRateGameAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={null}
        inLibrary
      />,
    );

    await user.click(screen.getByLabelText("3.5 stars"));

    await waitFor(() => {
      expect(screen.getByLabelText("3.5 stars")).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();

    resolveAction({ status: "success", message: "Rating saved." });

    await waitFor(() => {
      expect(screen.getByLabelText("3.5 stars")).toBeEnabled();
    });
  });

  it("disables the rating fieldset and Clear while a clear submission is pending", async () => {
    let resolveAction!: (value: { status: "success"; message: string }) => void;
    mockClearRatingAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <RatingControl
        gameId={gameId}
        gameSlug={gameSlug}
        currentRating={4}
        inLibrary
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear" }));

    // SubmitButton swaps its label to pendingText ("Clearing…") while its
    // own form is pending — the rating fieldset (a sibling form) disabling
    // too is the behavior this test actually verifies.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clearing…" })).toBeDisabled();
    });
    expect(screen.getByLabelText("5 stars")).toBeDisabled();

    resolveAction({ status: "success", message: "Rating cleared." });

    await waitFor(() => {
      expect(screen.getByLabelText("5 stars")).toBeEnabled();
    });
  });
});
