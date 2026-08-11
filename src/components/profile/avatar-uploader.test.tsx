import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockUploadAvatarAction, mockRemoveAvatarAction } = vi.hoisted(() => ({
  mockUploadAvatarAction: vi.fn(async (state: unknown) => state),
  mockRemoveAvatarAction: vi.fn(async () => ({
    status: "success" as const,
    message: "Avatar removed.",
  })),
}));

vi.mock("@/server/actions/profile", () => ({
  uploadAvatarAction: mockUploadAvatarAction,
  removeAvatarAction: mockRemoveAvatarAction,
}));

import { AvatarUploader } from "./avatar-uploader";

/**
 * Regression coverage for the bug where "Remove" appeared to do nothing:
 * the Remove button's <form> was nested inside the upload <form>, which is
 * invalid HTML that browsers silently refuse to submit. These tests pin
 * both the structural fix (no nested forms) and the resulting behavior
 * (Remove submits its own action, independent of the upload form).
 */
describe("AvatarUploader", () => {
  beforeEach(() => {
    mockUploadAvatarAction.mockClear();
    mockRemoveAvatarAction.mockClear();
  });

  it("never nests the Remove form inside the upload form", () => {
    const { container } = render(
      <AvatarUploader
        avatarUrl="https://example.com/avatar.png"
        initials="AB"
      />,
    );

    expect(container.querySelectorAll("form form")).toHaveLength(0);
  });

  it("renders no Remove button when there is no avatar to remove", () => {
    render(<AvatarUploader avatarUrl={null} initials="AB" />);

    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });

  it("submits the remove action when Remove is clicked, independent of upload", async () => {
    const user = userEvent.setup();
    render(
      <AvatarUploader
        avatarUrl="https://example.com/avatar.png"
        initials="AB"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockRemoveAvatarAction).toHaveBeenCalled();
    });
    expect(mockUploadAvatarAction).not.toHaveBeenCalled();
  });

  it("shows the removal success message once the action resolves", async () => {
    const user = userEvent.setup();
    render(
      <AvatarUploader
        avatarUrl="https://example.com/avatar.png"
        initials="AB"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Avatar removed.")).toBeInTheDocument();
  });
});
