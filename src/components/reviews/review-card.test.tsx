import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockToggleReviewLikeAction } = vi.hoisted(() => ({
  mockToggleReviewLikeAction: vi.fn(),
}));

vi.mock("@/server/actions/reviews", () => ({
  toggleReviewLikeAction: mockToggleReviewLikeAction,
}));

import {
  ReviewCard,
  type ReviewCardData,
  type ReviewCardAuthor,
} from "./review-card";

const review: ReviewCardData = {
  id: "5ee2dfc9-4557-5278-b5c8-285b9f0f1b69",
  rating: 4,
  body: "Great game.",
  hasSpoilers: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  gameSlug: "the-legend-of-zelda",
};

const author: ReviewCardAuthor = {
  username: "alice",
  displayName: "Alice",
  avatarUrl: null,
};

describe("ReviewCard — spoiler interaction", () => {
  it("hides the body behind a reveal button when hasSpoilers is true", () => {
    render(
      <ReviewCard
        review={{ ...review, hasSpoilers: true }}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: /click to reveal/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Great game.")).not.toBeInTheDocument();
  });

  it("never reveals on hover — click only", async () => {
    const user = userEvent.setup();
    render(
      <ReviewCard
        review={{ ...review, hasSpoilers: true }}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    await user.hover(screen.getByRole("button", { name: /click to reveal/i }));

    expect(screen.queryByText("Great game.")).not.toBeInTheDocument();
  });

  it("reveals the body on click", async () => {
    const user = userEvent.setup();
    render(
      <ReviewCard
        review={{ ...review, hasSpoilers: true }}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /click to reveal/i }));

    expect(screen.getByText("Great game.")).toBeInTheDocument();
  });

  it("marks the reveal button aria-expanded=false and points aria-controls at the (not yet rendered) body", () => {
    render(
      <ReviewCard
        review={{ ...review, hasSpoilers: true }}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    const revealButton = screen.getByRole("button", {
      name: /click to reveal/i,
    });
    expect(revealButton).toHaveAttribute("aria-expanded", "false");
    expect(revealButton.getAttribute("aria-controls")).toBeTruthy();
  });

  it("announces the reveal via an aria-live region — the body's id matches what aria-controls pointed at", async () => {
    const user = userEvent.setup();
    render(
      <ReviewCard
        review={{ ...review, hasSpoilers: true }}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    const revealButton = screen.getByRole("button", {
      name: /click to reveal/i,
    });
    const controlsId = revealButton.getAttribute("aria-controls");
    const liveRegion = revealButton.closest('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();

    await user.click(revealButton);

    const body = screen.getByText("Great game.");
    expect(body).toHaveAttribute("id", controlsId);
    expect(liveRegion).toContainElement(body);
  });

  it("shows a non-spoiler body immediately, no reveal control", () => {
    render(
      <ReviewCard
        review={review}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    expect(screen.getByText("Great game.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /click to reveal/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the review body unfiltered to its own author, even with spoilers set", () => {
    render(
      <ReviewCard
        review={{ ...review, hasSpoilers: true }}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
        isOwnReview
      />,
    );

    expect(screen.getByText("Great game.")).toBeInTheDocument();
  });
});

describe("ReviewCard — plain-text rendering, never HTML", () => {
  it("renders line breaks and literal angle-bracket text as inert plain text", () => {
    const { container } = render(
      <ReviewCard
        review={{
          ...review,
          body: "Line one\nLine two <script>alert('x')</script>",
        }}
        author={author}
        likeCount={0}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    const body = container.querySelector("p.whitespace-pre-wrap");
    expect(body).not.toBeNull();
    expect(body?.textContent).toBe(
      "Line one\nLine two <script>alert('x')</script>",
    );
  });
});

describe("ReviewCard — like button", () => {
  beforeEach(() => {
    mockToggleReviewLikeAction.mockReset();
  });

  it("optimistically flips liked state and count on click, before the action resolves", async () => {
    // Hold the action pending so the optimistic (pre-resolution) state is
    // observable — once revalidatePath's data actually lands (unreachable
    // in this isolated component test), the real app keeps this value; here
    // we only assert the immediate optimistic flip.
    let resolveAction!: (value: {
      status: "success";
      liked: boolean;
      likeCount: number;
    }) => void;
    mockToggleReviewLikeAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <ReviewCard
        review={review}
        author={author}
        likeCount={5}
        viewerHasLiked={false}
        canLike
      />,
    );

    await user.click(screen.getByRole("button", { name: /5/ }));

    expect(screen.getByRole("button", { name: /6/ })).toBeInTheDocument();
    expect(mockToggleReviewLikeAction).toHaveBeenCalledWith(
      review.id,
      true,
      review.gameSlug,
    );

    resolveAction({ status: "success", liked: true, likeCount: 6 });
  });

  it("rolls back the optimistic update on error", async () => {
    mockToggleReviewLikeAction.mockResolvedValue({
      status: "error",
      liked: false,
      message: "Couldn't like this review. Please try again.",
    });
    const user = userEvent.setup();
    render(
      <ReviewCard
        review={review}
        author={author}
        likeCount={5}
        viewerHasLiked={false}
        canLike
      />,
    );

    await user.click(screen.getByRole("button", { name: /5/ }));

    expect(
      await screen.findByRole("button", { name: /5/ }),
    ).toBeInTheDocument();
  });

  it("shows a read-only like count with no button for a signed-out viewer", () => {
    render(
      <ReviewCard
        review={review}
        author={author}
        likeCount={3}
        viewerHasLiked={false}
        canLike={false}
      />,
    );

    expect(screen.getByText("3 likes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /3/ })).not.toBeInTheDocument();
  });
});
