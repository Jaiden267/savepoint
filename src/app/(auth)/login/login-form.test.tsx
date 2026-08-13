import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockSignInAction, mockResendConfirmationAction } = vi.hoisted(() => ({
  mockSignInAction: vi.fn(),
  mockResendConfirmationAction: vi.fn(),
}));

vi.mock("@/server/actions/auth", () => ({
  signInAction: mockSignInAction,
  resendConfirmationAction: mockResendConfirmationAction,
}));

import { LoginForm } from "./login-form";

beforeEach(() => {
  mockSignInAction.mockReset();
  mockResendConfirmationAction.mockReset();
});

describe("LoginForm", () => {
  it("renders a hidden next field when a next prop is given", () => {
    const { container } = render(<LoginForm next="/settings/profile" />);

    expect(
      container.querySelector('input[type="hidden"][name="next"]'),
    ).toHaveValue("/settings/profile");
  });

  it("the resend-confirmation form is a sibling, not nested inside, the sign-in form", () => {
    const { container } = render(<LoginForm />);

    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.closest("form")).toBe(form);
    }
  });

  it("expanding the resend disclosure and submitting calls resendConfirmationAction, not signInAction", async () => {
    mockResendConfirmationAction.mockResolvedValue({
      status: "success",
      message: "If that email needs confirming, we've sent a new link.",
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByText(/didn't confirm your email\?/i));
    const resendEmailInput = screen.getAllByLabelText("Email")[1]!;
    await user.type(resendEmailInput, "user@example.com");
    await user.click(
      screen.getByRole("button", { name: /resend confirmation email/i }),
    );

    await waitFor(() => {
      expect(mockResendConfirmationAction).toHaveBeenCalled();
    });
    expect(mockSignInAction).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(<LoginForm />);
    expectNoAxeViolations(await axe(container));
  });
});
