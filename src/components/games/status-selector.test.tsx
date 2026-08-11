import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockSetGameStatusAction, mockRemoveFromLibraryAction } = vi.hoisted(
  () => ({
    mockSetGameStatusAction: vi.fn(
      async (state: unknown, _formData: FormData) => state,
    ),
    mockRemoveFromLibraryAction: vi.fn(async () => ({
      status: "success" as const,
      message: "Removed from library.",
    })),
  }),
);

vi.mock("@/server/actions/library", () => ({
  setGameStatusAction: mockSetGameStatusAction,
  removeFromLibraryAction: mockRemoveFromLibraryAction,
  rateGameAction: vi.fn(),
  clearRatingAction: vi.fn(),
}));

import { StatusSelector } from "./status-selector";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const gameSlug = "the-legend-of-zelda";

describe("StatusSelector", () => {
  beforeEach(() => {
    mockSetGameStatusAction.mockClear();
    mockRemoveFromLibraryAction.mockClear();
  });

  it("auto-submits setGameStatusAction when a status is chosen", async () => {
    const user = userEvent.setup();
    render(
      <StatusSelector
        gameId={gameId}
        gameSlug={gameSlug}
        currentStatus={null}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("Library status"),
      "playing",
    );

    await waitFor(() => {
      expect(mockSetGameStatusAction).toHaveBeenCalled();
    });
    const [, formData] = mockSetGameStatusAction.mock.calls[0] as [
      unknown,
      FormData,
    ];
    expect(formData.get("status")).toBe("playing");
  });

  it("renders no Remove control until the game is already in the library", () => {
    render(
      <StatusSelector
        gameId={gameId}
        gameSlug={gameSlug}
        currentStatus={null}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });

  it("requires confirming the dialog before removing — the initial click alone does not remove", async () => {
    const user = userEvent.setup();
    render(
      <StatusSelector
        gameId={gameId}
        gameSlug={gameSlug}
        currentStatus="playing"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(mockRemoveFromLibraryAction).not.toHaveBeenCalled();
    expect(screen.getByText(/remove from library\?/i)).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockRemoveFromLibraryAction).toHaveBeenCalled();
    });
  });
});
