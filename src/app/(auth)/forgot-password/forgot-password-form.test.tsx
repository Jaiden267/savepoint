import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockForgotPasswordAction } = vi.hoisted(() => ({
  mockForgotPasswordAction: vi.fn(),
}));

vi.mock("@/server/actions/auth", () => ({
  forgotPasswordAction: mockForgotPasswordAction,
}));

import { ForgotPasswordForm } from "./forgot-password-form";

beforeEach(() => {
  mockForgotPasswordAction.mockReset();
});

describe("ForgotPasswordForm", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ForgotPasswordForm />);
    expectNoAxeViolations(await axe(container));
  });
});
