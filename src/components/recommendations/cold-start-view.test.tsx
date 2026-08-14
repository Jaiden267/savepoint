import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { ColdStartView } from "./cold-start-view";

const genres = [
  { slug: "rpg", name: "RPG" },
  { slug: "stealth", name: "Stealth" },
];

beforeEach(() => {
  mockPush.mockReset();
});

describe("ColdStartView", () => {
  it("explains why, without claiming personalization", () => {
    render(<ColdStartView genres={genres} />);
    expect(
      screen.getByText(/rate a few games to get personalized recommendations/i),
    ).toBeInTheDocument();
  });

  it("always offers a link to broad Discover", () => {
    render(<ColdStartView genres={genres} />);
    const link = screen.getByRole("link", { name: /browse discover/i });
    expect(link).toHaveAttribute("href", "/discover");
  });

  it("the submit button is disabled until at least one genre is selected", async () => {
    const user = userEvent.setup();
    render(<ColdStartView genres={genres} />);

    const submit = screen.getByRole("button", {
      name: /show me something in these genres/i,
    });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "RPG" }));
    expect(submit).toBeEnabled();
  });

  it("toggling a genre twice deselects it again", async () => {
    const user = userEvent.setup();
    render(<ColdStartView genres={genres} />);

    const rpgButton = screen.getByRole("button", { name: "RPG" });
    await user.click(rpgButton);
    expect(rpgButton).toHaveAttribute("aria-pressed", "true");
    await user.click(rpgButton);
    expect(rpgButton).toHaveAttribute("aria-pressed", "false");
  });

  it("submitting navigates with the selected genre slugs and a fresh seed — hints are only ever a URL param, never stored anywhere by this component", async () => {
    const user = userEvent.setup();
    render(<ColdStartView genres={genres} />);

    await user.click(screen.getByRole("button", { name: "RPG" }));
    await user.click(screen.getByRole("button", { name: "Stealth" }));
    await user.click(
      screen.getByRole("button", {
        name: /show me something in these genres/i,
      }),
    );

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/^\/recommendations\?seed=\d+&genres=rpg%2Cstealth$/);
  });

  it("renders no genre picker at all when no genres are available", () => {
    render(<ColdStartView genres={[]} />);
    expect(
      screen.queryByRole("group", { name: /genre preferences/i }),
    ).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ColdStartView genres={genres} />);
    expectNoAxeViolations(await axe(container));
  });
});
