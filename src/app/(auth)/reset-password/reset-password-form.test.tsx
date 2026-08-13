import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockResetPasswordAction } = vi.hoisted(() => ({
  mockResetPasswordAction: vi.fn(),
}));

vi.mock("@/server/actions/auth", () => ({
  resetPasswordAction: mockResetPasswordAction,
}));

import { ResetPasswordForm } from "./reset-password-form";

beforeEach(() => {
  mockResetPasswordAction.mockReset();
});

describe("ResetPasswordForm", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ResetPasswordForm />);
    expectNoAxeViolations(await axe(container));
  });
});
