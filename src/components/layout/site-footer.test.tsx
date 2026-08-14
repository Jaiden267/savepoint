import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders a working /privacy link", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("orders its content copyright → Privacy → tagline", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const texts = Array.from(footer.querySelectorAll("p, a")).map(
      (el) => el.textContent,
    );
    const copyrightIndex = texts.findIndex((t) => t?.includes("Savepoint."));
    const privacyIndex = texts.findIndex((t) => t === "Privacy");
    const taglineIndex = texts.findIndex((t) =>
      t?.includes("Track, rate and discover"),
    );

    expect(copyrightIndex).toBeGreaterThanOrEqual(0);
    expect(privacyIndex).toBeGreaterThan(copyrightIndex);
    expect(taglineIndex).toBeGreaterThan(privacyIndex);
  });

  it("the Privacy link is reachable and activatable by keyboard", async () => {
    const user = userEvent.setup();
    render(<SiteFooter />);

    await user.tab();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveFocus();
  });

  it("renders no nested interactive elements (a real <a>, not a link wrapping another control)", () => {
    render(<SiteFooter />);

    const privacyLink = screen.getByRole("link", { name: "Privacy" });
    expect(privacyLink.tagName).toBe("A");
    expect(privacyLink.querySelector("a, button, input, select")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<SiteFooter />);
    expectNoAxeViolations(await axe(container));
  });

  it("uses the robust three-column grid (minmax(0,1fr) auto minmax(0,1fr)) so the middle item stays centred regardless of the outer items' content length", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const row = footer.firstElementChild as HTMLElement;
    expect(row.className).toContain(
      "sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
    );

    const copyright = screen.getByText(/Savepoint\./).closest("p")!;
    const privacyLink = screen.getByRole("link", { name: "Privacy" });
    const tagline = screen.getByText(/Track, rate and discover/).closest("p")!;

    // Middle item centred at every breakpoint; outer items pinned to the
    // grid's own start/end edges on sm+ — not centred against each other,
    // which is what let the link drift off-centre before this fix.
    expect(privacyLink.className).toContain("justify-self-center");
    expect(copyright.className).toContain("sm:justify-self-start");
    expect(tagline.className).toContain("sm:justify-self-end");
  });
});
