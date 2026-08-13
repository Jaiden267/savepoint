import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialActionState } from "@/lib/action-state";
import { _resetRateLimitsForTests } from "@/lib/rate-limit";

const {
  mockGetClientIdentifier,
  mockSignUp,
  mockSignInWithPassword,
  mockSignOut,
  mockResetPasswordForEmail,
  mockUpdateUser,
  mockResend,
  mockGetUser,
  mockMaybeSingle,
  mockFrom,
  mockRedirect,
} = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  return {
    mockGetClientIdentifier: vi.fn(),
    mockSignUp: vi.fn(),
    mockSignInWithPassword: vi.fn(),
    mockSignOut: vi.fn(),
    mockResetPasswordForEmail: vi.fn(),
    mockUpdateUser: vi.fn(),
    mockResend: vi.fn(),
    mockGetUser: vi.fn(),
    mockMaybeSingle,
    mockFrom,
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  };
});

vi.mock("@/lib/auth/request-ip", () => ({
  getClientIdentifier: mockGetClientIdentifier,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signUp: mockSignUp,
        signInWithPassword: mockSignInWithPassword,
        signOut: mockSignOut,
        resetPasswordForEmail: mockResetPasswordForEmail,
        updateUser: mockUpdateUser,
        resend: mockResend,
        getUser: mockGetUser,
      },
      from: mockFrom,
    }),
  ),
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import {
  signUpAction,
  signInAction,
  signOutAction,
  forgotPasswordAction,
  resetPasswordAction,
  resendConfirmationAction,
} from "./auth";

function signUpForm(email: string, password = "password123") {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  data.set("confirmPassword", password);
  return data;
}

function signInForm(email: string, password = "password123", next?: string) {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  if (next !== undefined) data.set("next", next);
  return data;
}

function emailOnlyForm(email: string) {
  const data = new FormData();
  data.set("email", email);
  return data;
}

function resetPasswordForm(password = "password123") {
  const data = new FormData();
  data.set("password", password);
  data.set("confirmPassword", password);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  mockGetClientIdentifier.mockResolvedValue("client-1");
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
});

describe("signUpAction", () => {
  it("rejects an invalid email before calling Supabase", async () => {
    const result = await signUpAction(
      initialActionState,
      signUpForm("not-an-email"),
    );

    expect(result.status).toBe("error");
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("returns success with the submitted email for the resend-confirmation prefill", async () => {
    mockSignUp.mockResolvedValue({ error: null });

    const result = await signUpAction(
      initialActionState,
      signUpForm("new@example.com"),
    );

    expect(result).toEqual({
      status: "success",
      message:
        "Check your inbox to confirm your email and finish creating your account.",
      email: "new@example.com",
    });
  });

  it("maps an 'already registered' Supabase error to friendly copy", async () => {
    mockSignUp.mockResolvedValue({
      error: { message: "User already registered" },
    });

    const result = await signUpAction(
      initialActionState,
      signUpForm("existing@example.com"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/already exists/i);
  });

  it("rate-limits after 5 attempts from the same client in the window", async () => {
    mockSignUp.mockResolvedValue({ error: null });

    for (let i = 0; i < 5; i++) {
      await signUpAction(initialActionState, signUpForm(`u${i}@example.com`));
    }
    const result = await signUpAction(
      initialActionState,
      signUpForm("u5@example.com"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/too many attempts/i);
    expect(mockSignUp).toHaveBeenCalledTimes(5);
  });
});

describe("signInAction", () => {
  it("rejects invalid input before calling Supabase", async () => {
    const result = await signInAction(
      initialActionState,
      signInForm("not-an-email", ""),
    );

    expect(result.status).toBe("error");
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("maps invalid credentials to friendly copy, never the raw Supabase message", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    const result = await signInAction(
      initialActionState,
      signInForm("user@example.com", "wrong"),
    );

    expect(result.status).toBe("error");
    expect(result.message).not.toMatch(/invalid login credentials/i);
    expect(result.message).toMatch(/don't match/i);
  });

  it("redirects to a safe next path when one is provided", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    await expect(
      signInAction(
        initialActionState,
        signInForm("user@example.com", "password123", "/settings/profile"),
      ),
    ).rejects.toThrow("REDIRECT:/settings/profile");
  });

  it("ignores an unsafe next path and falls back to the user's profile", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { username: "alice" },
      error: null,
    });

    await expect(
      signInAction(
        initialActionState,
        signInForm(
          "user@example.com",
          "password123",
          "https://evil.example.com",
        ),
      ),
    ).rejects.toThrow("REDIRECT:/users/alice");
  });
});

describe("signOutAction", () => {
  it("signs out and redirects home", async () => {
    mockSignOut.mockResolvedValue({ error: null });

    await expect(signOutAction()).rejects.toThrow("REDIRECT:/");
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe("forgotPasswordAction — anti-enumeration", () => {
  it("returns the identical success message whether or not the account exists", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    const existing = await forgotPasswordAction(
      initialActionState,
      emailOnlyForm("real@example.com"),
    );

    _resetRateLimitsForTests();
    mockResetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found" },
    });
    const nonexistent = await forgotPasswordAction(
      initialActionState,
      emailOnlyForm("nobody@example.com"),
    );

    expect(existing).toEqual(nonexistent);
    expect(existing.status).toBe("success");
    expect(existing.message).toMatch(/spam or junk/i);
  });
});

describe("resetPasswordAction", () => {
  it("is rate-limited (new hardening — previously unlimited)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockUpdateUser.mockResolvedValue({ error: null });
    mockMaybeSingle.mockResolvedValue({
      data: { username: "alice" },
      error: null,
    });

    for (let i = 0; i < 10; i++) {
      await expect(
        resetPasswordAction(initialActionState, resetPasswordForm()),
      ).rejects.toThrow("REDIRECT:/users/alice");
    }
    const result = await resetPasswordAction(
      initialActionState,
      resetPasswordForm(),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/too many attempts/i);
  });

  it("returns a friendly error when there is no active recovery session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await resetPasswordAction(
      initialActionState,
      resetPasswordForm(),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/expired/i);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe("resendConfirmationAction", () => {
  it("rejects an invalid email before calling Supabase", async () => {
    const result = await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("not-an-email"),
    );

    expect(result.status).toBe("error");
    expect(mockResend).not.toHaveBeenCalled();
  });

  it("returns the identical success message whether or not the account exists or is already confirmed", async () => {
    mockResend.mockResolvedValue({ error: null });
    const existing = await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("real@example.com"),
    );

    _resetRateLimitsForTests();
    mockResend.mockResolvedValue({
      error: { message: "Email already confirmed" },
    });
    const alreadyConfirmed = await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("confirmed@example.com"),
    );

    expect(existing).toEqual(alreadyConfirmed);
    expect(existing.status).toBe("success");
    expect(existing.message).toMatch(/spam or junk/i);
  });

  it("calls resend with type 'signup' and an emailRedirectTo built from the app URL", async () => {
    mockResend.mockResolvedValue({ error: null });

    await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("real@example.com"),
    );

    expect(mockResend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "signup",
        email: "real@example.com",
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining("/auth/callback"),
        }),
      }),
    );
  });

  it("rate-limits per IP after 5 attempts in the window", async () => {
    mockResend.mockResolvedValue({ error: null });

    for (let i = 0; i < 5; i++) {
      await resendConfirmationAction(
        initialActionState,
        emailOnlyForm(`u${i}@example.com`),
      );
    }
    const result = await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("u5@example.com"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/too many attempts/i);
  });

  it("rate-limits a second attempt for the same email within 60s, even from a different client", async () => {
    mockResend.mockResolvedValue({ error: null });

    await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("same@example.com"),
    );

    mockGetClientIdentifier.mockResolvedValue("client-2");
    const result = await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("same@example.com"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/too many attempts/i);
  });

  it("treats differently-cased emails as the same cooldown target", async () => {
    mockResend.mockResolvedValue({ error: null });

    await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("Same@Example.com"),
    );
    const result = await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("same@example.com"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/too many attempts/i);
  });

  it("still allows a different email from the same client immediately after", async () => {
    mockResend.mockResolvedValue({ error: null });

    await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("first@example.com"),
    );
    const result = await resendConfirmationAction(
      initialActionState,
      emailOnlyForm("second@example.com"),
    );

    expect(result.status).toBe("success");
  });
});
