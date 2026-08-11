import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { OwnReviewCard } from "./own-review-card";

/**
 * Regression guard for the exact crash this component previously caused:
 * "Attempted to call starGlyphs() from the server but starGlyphs is on the
 * client." own-review-card.tsx is a Server Component (no "use client") — it
 * must never import a runtime binding from a module that has "use client",
 * since Next only lets a Server Component render a Client Component as
 * JSX, not call a plain function out of one. Vitest/jsdom can't reproduce
 * the actual RSC-boundary crash (only Next's real bundler enforces it —
 * see the standalone smoke test for that), so this is a deterministic,
 * source-level check instead: it would have failed the moment starGlyphs
 * was imported from review-card.tsx, and fails again if that ever
 * regresses.
 */
describe("OwnReviewCard — Server/Client boundary", () => {
  const componentPath = path.resolve(__dirname, "own-review-card.tsx");
  const source = readFileSync(componentPath, "utf8");

  it("is not itself a Client Component", () => {
    expect(source.trimStart().startsWith('"use client"')).toBe(false);
  });

  it('does not import any runtime binding from review-card.tsx (a "use client" module) — only from server-safe @/lib/rating', () => {
    expect(source).not.toMatch(
      /from ["']@\/components\/reviews\/review-card["']/,
    );
    expect(source).toMatch(/starGlyphs.*from ["']@\/lib\/rating["']/);
  });
});

describe("OwnReviewCard", () => {
  it("renders nothing when there is no own review", () => {
    const { container } = render(<OwnReviewCard ownReview={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the rating, spoiler badge, and body when a review is present", () => {
    render(
      <OwnReviewCard
        ownReview={{
          id: "review-1",
          rating: 4.5,
          body: "Loved it.",
          hasSpoilers: true,
        }}
      />,
    );

    expect(screen.getByText("Your review")).toBeInTheDocument();
    expect(screen.getByLabelText("4.5 out of 5 stars")).toBeInTheDocument();
    expect(screen.getByText("Contains spoilers")).toBeInTheDocument();
    expect(screen.getByText("Loved it.")).toBeInTheDocument();
  });

  it("omits the spoiler badge when hasSpoilers is false", () => {
    render(
      <OwnReviewCard
        ownReview={{
          id: "review-1",
          rating: 3,
          body: "Decent.",
          hasSpoilers: false,
        }}
      />,
    );

    expect(screen.queryByText("Contains spoilers")).not.toBeInTheDocument();
  });

  it("renders a body with a line break and literal angle-bracket text as inert plain text", () => {
    const { container } = render(
      <OwnReviewCard
        ownReview={{
          id: "review-1",
          rating: 3,
          body: "First line\n<b>test</b>",
          hasSpoilers: false,
        }}
      />,
    );

    expect(container.querySelector("b")).toBeNull();
    const body = container.querySelector("p.whitespace-pre-wrap");
    expect(body).not.toBeNull();
    expect(body?.textContent).toBe("First line\n<b>test</b>");
  });
});
