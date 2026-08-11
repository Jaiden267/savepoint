import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockToggleFollowAction } = vi.hoisted(() => ({
  mockToggleFollowAction: vi.fn(),
}));

vi.mock("@/server/actions/follows", () => ({
  toggleFollowAction: mockToggleFollowAction,
}));

import { FollowButton } from "./follow-button";

const TARGET_ID = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";

beforeEach(() => {
  mockToggleFollowAction.mockReset();
});

describe("FollowButton", () => {
  it("optimistically flips to 'Following' on click, before the action resolves", async () => {
    let resolveAction!: (value: {
      status: "success";
      following: boolean;
    }) => void;
    mockToggleFollowAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <FollowButton
        targetUserId={TARGET_ID}
        targetUsername="alice"
        initialFollowing={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^follow$/i }));

    expect(
      screen.getByRole("button", { name: /following/i }),
    ).toBeInTheDocument();
    expect(mockToggleFollowAction).toHaveBeenCalledWith(
      TARGET_ID,
      true,
      "alice",
    );

    resolveAction({ status: "success", following: true });
  });

  it("rolls back to 'Follow' on error", async () => {
    mockToggleFollowAction.mockResolvedValue({
      status: "error",
      following: false,
      message: "Couldn't follow this user. Please try again.",
    });
    const user = userEvent.setup();
    render(
      <FollowButton
        targetUserId={TARGET_ID}
        targetUsername="alice"
        initialFollowing={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^follow$/i }));

    expect(
      await screen.findByRole("button", { name: /^follow$/i }),
    ).toBeInTheDocument();
  });

  it("starts in the 'Following' state and unfollows on click", async () => {
    mockToggleFollowAction.mockResolvedValue({
      status: "success",
      following: false,
    });
    const user = userEvent.setup();
    render(
      <FollowButton
        targetUserId={TARGET_ID}
        targetUsername="alice"
        initialFollowing
      />,
    );

    expect(
      screen.getByRole("button", { name: /following/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /following/i }));

    expect(mockToggleFollowAction).toHaveBeenCalledWith(
      TARGET_ID,
      false,
      "alice",
    );
  });
});
