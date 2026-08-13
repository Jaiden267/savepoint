import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockResendConfirmationAction } = vi.hoisted(() => ({
  mockResendConfirmationAction: vi.fn(),
}));

vi.mock("@/server/actions/auth", () => ({
  resendConfirmationAction: mockResendConfirmationAction,
}));

import { ResendConfirmationForm } from "./resend-confirmation-form";

beforeEach(() => {
  mockResendConfirmationAction.mockReset();
});

describe("ResendConfirmationForm", () => {
  it("prefills the email field from defaultEmail", () => {
    render(<ResendConfirmationForm defaultEmail="user@example.com" />);

    expect(screen.getByLabelText("Email")).toHaveValue("user@example.com");
  });

  it("renders empty when no defaultEmail is given", () => {
    render(<ResendConfirmationForm />);

    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("submits the entered email and replaces the form with the success message", async () => {
    mockResendConfirmationAction.mockResolvedValue({
      status: "success",
      message: "If that email needs confirming, we've sent a new link.",
    });
    const user = userEvent.setup();
    render(<ResendConfirmationForm />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.click(
      screen.getByRole("button", { name: /resend confirmation email/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/we've sent a new link/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /resend confirmation email/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an error message and keeps the form visible on failure", async () => {
    mockResendConfirmationAction.mockResolvedValue({
      status: "error",
      message: "Too many attempts. Please wait a moment and try again.",
    });
    const user = userEvent.setup();
    render(<ResendConfirmationForm defaultEmail="user@example.com" />);

    await user.click(
      screen.getByRole("button", { name: /resend confirmation email/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/too many attempts/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /resend confirmation email/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ResendConfirmationForm />);
    expectNoAxeViolations(await axe(container));
  });
});
