import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockClientEnv } = vi.hoisted(() => ({
  mockClientEnv: {
    NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL: undefined as string | undefined,
  },
}));

vi.mock("@/lib/env", () => ({
  clientEnv: mockClientEnv,
}));

import PrivacyPolicyPage from "./page";

beforeEach(() => {
  mockClientEnv.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL = undefined;
});

describe("PrivacyPolicyPage", () => {
  it("renders the primary heading", () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy policy" }),
    ).toBeInTheDocument();
  });

  it("renders the essential policy sections", () => {
    render(<PrivacyPolicyPage />);

    for (const heading of [
      "1. Who operates Savepoint",
      "2. Information we collect",
      "5. Service providers we use",
      "7. Data retention",
      "8. Account deletion and your rights",
      "9. Personalisation and recommendations",
      "10. Children's privacy",
      "11. Cookies and similar technology",
      "14. How to contact us",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name: heading }),
      ).toBeInTheDocument();
    }
  });

  it("names the real service providers this app actually integrates with", () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getAllByText(/Supabase/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Resend/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pinecone/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/IGDB \/ Twitch/).length).toBeGreaterThan(0);
  });

  it("links to the ICO complaint page", () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByRole("link", { name: "ico.org.uk" })).toHaveAttribute(
      "href",
      "https://ico.org.uk",
    );
  });

  it("shows a mailto contact link when a contact address is configured", () => {
    mockClientEnv.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL = "privacy@example.com";
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole("link", { name: "privacy@example.com" }),
    ).toHaveAttribute("href", "mailto:privacy@example.com");
  });

  it("fails safely with an honest notice, never a broken mailto, when no contact address is configured", () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByText(/has not yet been published here/i),
    ).toBeInTheDocument();
    const mailtoLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("mailto:"));
    expect(mailtoLinks).toHaveLength(0);
  });

  it("has no axe violations", async () => {
    const { container } = render(<PrivacyPolicyPage />);
    expectNoAxeViolations(await axe(container));
  });
});
