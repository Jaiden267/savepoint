import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockImportCatalogueGameAction } = vi.hoisted(() => ({
  mockImportCatalogueGameAction: vi.fn(
    async (state: unknown, _formData: FormData) => state,
  ),
}));

vi.mock("@/server/actions/games", () => ({
  importCatalogueGameAction: mockImportCatalogueGameAction,
}));

import { CatalogueResultCard } from "./catalogue-result-card";

beforeEach(() => {
  mockImportCatalogueGameAction.mockClear();
});

describe("CatalogueResultCard", () => {
  it("renders a real <button type='submit'> with a clear accessible name — not a <Link>", () => {
    render(
      <CatalogueResultCard
        igdbId={42}
        name="Some Uncached Game"
        coverImageId={null}
        releaseYear={2021}
      />,
    );

    const button = screen.getByRole("button", {
      name: /import and open some uncached game/i,
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "submit");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("posts the igdbId as a hidden field on the enclosing form", () => {
    const { container } = render(
      <CatalogueResultCard
        igdbId={999}
        name="Another Game"
        coverImageId={null}
        releaseYear={null}
      />,
    );

    const hidden = container.querySelector('input[name="igdbId"]');
    expect(hidden).toHaveValue("999");
  });

  it("is keyboard-operable — Enter on the focused button submits the form", async () => {
    const user = userEvent.setup();
    render(
      <CatalogueResultCard
        igdbId={7}
        name="Keyboard Game"
        coverImageId={null}
        releaseYear={null}
      />,
    );

    const button = screen.getByRole("button", { name: /keyboard game/i });
    button.focus();
    await user.keyboard("{Enter}");

    expect(mockImportCatalogueGameAction).toHaveBeenCalled();
  });

  it("shows the release year and no nested-interactive-control issue (a single interactive element, not a link wrapping a button)", () => {
    render(
      <CatalogueResultCard
        igdbId={7}
        name="Year Game"
        coverImageId={null}
        releaseYear={2015}
      />,
    );

    expect(screen.getByText("2015")).toBeInTheDocument();
    // Exactly one interactive element for the whole card.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CatalogueResultCard
        igdbId={7}
        name="Accessible Game"
        coverImageId={null}
        releaseYear={2015}
      />,
    );
    expectNoAxeViolations(await axe(container));
  });
});
