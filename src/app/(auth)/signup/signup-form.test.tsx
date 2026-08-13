import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockSignUpAction, mockResendConfirmationAction } = vi.hoisted(() => ({
  mockSignUpAction: vi.fn(),
  mockResendConfirmationAction: vi.fn(),
}));

vi.mock("@/server/actions/auth", () => ({
  signUpAction: mockSignUpAction,
  resendConfirmationAction: mockResendConfirmationAction,
}));

import { SignupForm } from "./signup-form";

beforeEach(() => {
  mockSignUpAction.mockReset();
  mockResendConfirmationAction.mockReset();
});

describe("SignupForm", () => {
  it("on success, replaces the form with the resend-confirmation form prefilled with the submitted email", async () => {
    mockSignUpAction.mockResolvedValue({
      status: "success",
      message:
        "Check your inbox to confirm your email and finish creating your account.",
      email: "new@example.com",
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your inbox to confirm/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Email")).toHaveValue("new@example.com");
    expect(
      screen.getByRole("button", { name: /resend confirmation email/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<SignupForm />);
    expectNoAxeViolations(await axe(container));
  });
});
