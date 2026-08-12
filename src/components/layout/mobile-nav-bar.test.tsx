import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/home"),
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

import { MobileNavBar } from "./mobile-nav-bar";

describe("MobileNavBar", () => {
  it("renders all 5 primary destinations as links", () => {
    render(<MobileNavBar />);

    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute(
      "href",
      "/home",
    );
    expect(screen.getByRole("link", { name: /discover/i })).toHaveAttribute(
      "href",
      "/discover",
    );
    expect(screen.getByRole("link", { name: /search/i })).toHaveAttribute(
      "href",
      "/search",
    );
    expect(screen.getByRole("link", { name: /library/i })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.getByRole("link", { name: /diary/i })).toHaveAttribute(
      "href",
      "/diary",
    );
  });

  it("marks the active tab with aria-current, and only that tab", () => {
    mockUsePathname.mockReturnValue("/library");
    render(<MobileNavBar />);

    expect(screen.getByRole("link", { name: /library/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /home/i })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: /discover/i })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("treats nested paths under a tab as active (e.g. a sub-route of /library)", () => {
    mockUsePathname.mockReturnValue("/library/backlog");
    render(<MobileNavBar />);

    expect(screen.getByRole("link", { name: /library/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("carries the presence marker globals.css keys its body padding-bottom rule on", () => {
    mockUsePathname.mockReturnValue("/home");
    const { container } = render(<MobileNavBar />);

    expect(container.querySelector("[data-mobile-nav-bar]")).not.toBeNull();
  });

  it("has no axe violations", async () => {
    mockUsePathname.mockReturnValue("/home");
    const { container } = render(<MobileNavBar />);

    expectNoAxeViolations(await axe(container));
  });
});
