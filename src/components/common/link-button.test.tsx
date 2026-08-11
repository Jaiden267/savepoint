import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LinkButton } from "./link-button";

/**
 * Regression coverage for the dev-console warning "A component that acts as
 * a button expected a native <button>...": it fired because several places
 * rendered Base UI's Button primitive as a next/link Link via the `render`
 * prop, which swaps the real DOM node for an <a> — Base UI's own docs say
 * links shouldn't be routed through Button that way. LinkButton sidesteps
 * Base UI's Button entirely and applies the same classes to a real Link, so
 * navigation keeps native anchor semantics with nothing to warn about.
 */
describe("LinkButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a real anchor with link semantics, not button semantics", () => {
    render(<LinkButton href="/search">Browse</LinkButton>);

    const link = screen.getByRole("link", { name: "Browse" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/search");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies button visual styling via the shared buttonVariants classes", () => {
    render(<LinkButton href="/search">Browse</LinkButton>);

    const link = screen.getByRole("link", { name: "Browse" });
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link.className).toContain("inline-flex");
  });

  it("never triggers Base UI's native-button dev warning", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <LinkButton variant="secondary" size="sm" href="/settings/profile">
        Edit profile
      </LinkButton>,
    );

    const baseUiWarnings = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("Base UI"),
    );
    expect(baseUiWarnings).toHaveLength(0);
  });
});
