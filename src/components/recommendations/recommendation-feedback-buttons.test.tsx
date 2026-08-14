import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockToggleRecommendationFeedbackAction } = vi.hoisted(() => ({
  mockToggleRecommendationFeedbackAction: vi.fn(),
}));

vi.mock("@/server/actions/recommendations", () => ({
  toggleRecommendationFeedbackAction: mockToggleRecommendationFeedbackAction,
}));

import { RecommendationFeedbackButtons } from "./recommendation-feedback-buttons";

beforeEach(() => {
  mockToggleRecommendationFeedbackAction.mockReset();
});

describe("RecommendationFeedbackButtons", () => {
  it("renders all three feedback buttons with correct accessible names", () => {
    render(<RecommendationFeedbackButtons igdbId={123} />);
    expect(screen.getByRole("button", { name: "Helpful" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Not interested" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Already played" }),
    ).toBeInTheDocument();
  });

  it("'Already played' has an accessible description clarifying it doesn't touch the library", () => {
    render(<RecommendationFeedbackButtons igdbId={123} />);
    expect(
      screen.getByRole("button", { name: "Already played" }),
    ).toHaveAttribute(
      "title",
      expect.stringContaining("doesn't change your library"),
    );
  });

  it("optimistically sets aria-pressed on click, before the action resolves", async () => {
    let resolveAction!: (v: { status: "success"; active: boolean }) => void;
    mockToggleRecommendationFeedbackAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<RecommendationFeedbackButtons igdbId={123} />);

    const helpfulButton = screen.getByRole("button", { name: "Helpful" });
    await user.click(helpfulButton);

    expect(helpfulButton).toHaveAttribute("aria-pressed", "true");
    expect(mockToggleRecommendationFeedbackAction).toHaveBeenCalledWith(
      123,
      "saved",
    );
    resolveAction({ status: "success", active: true });
  });

  it("is disabled while the transition is pending", async () => {
    let resolveAction!: (v: { status: "success"; active: boolean }) => void;
    mockToggleRecommendationFeedbackAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<RecommendationFeedbackButtons igdbId={123} />);

    const button = screen.getByRole("button", { name: "Not interested" });
    await user.click(button);

    expect(button).toBeDisabled();
    resolveAction({ status: "success", active: true });
  });

  it("rolls back aria-pressed to false on error", async () => {
    mockToggleRecommendationFeedbackAction.mockResolvedValue({
      status: "error",
      active: false,
      message: "Too many requests. Please wait a bit and try again.",
    });
    const user = userEvent.setup();
    render(<RecommendationFeedbackButtons igdbId={123} />);

    const button = screen.getByRole("button", { name: "Already played" });
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Already played" }),
      ).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("each button toggles independently — clicking one doesn't affect the others' state", async () => {
    mockToggleRecommendationFeedbackAction.mockResolvedValue({
      status: "success",
      active: true,
    });
    const user = userEvent.setup();
    render(<RecommendationFeedbackButtons igdbId={123} />);

    await user.click(screen.getByRole("button", { name: "Helpful" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Helpful" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(
      screen.getByRole("button", { name: "Not interested" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Already played" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <RecommendationFeedbackButtons igdbId={123} />,
    );
    expectNoAxeViolations(await axe(container));
  });
});
