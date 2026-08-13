import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { DiscoverShuffleButton } from "./discover-shuffle-button";

beforeEach(() => {
  mockPush.mockReset();
});

describe("DiscoverShuffleButton", () => {
  it("has the accessible name 'Shuffle games' on a real <button>", () => {
    render(<DiscoverShuffleButton />);
    const button = screen.getByRole("button", { name: "Shuffle games" });
    expect(button.tagName).toBe("BUTTON");
  });

  it("clicking navigates to /discover?seed=<number> via router.push", async () => {
    const user = userEvent.setup();
    render(<DiscoverShuffleButton />);

    await user.click(screen.getByRole("button", { name: "Shuffle games" }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/^\/discover\?seed=\d+$/);
  });

  it("two separate clicks produce two different seeds", async () => {
    const user = userEvent.setup();
    render(<DiscoverShuffleButton />);

    await user.click(screen.getByRole("button", { name: "Shuffle games" }));
    await user.click(screen.getByRole("button", { name: "Shuffle games" }));

    const seeds = mockPush.mock.calls.map((call) => call[0] as string);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it("is keyboard-operable — Tab focuses it, Enter activates it", async () => {
    const user = userEvent.setup();
    render(<DiscoverShuffleButton />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Shuffle games" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("uses router.push (not replace) so shuffle history is preserved for Back/Forward", async () => {
    const user = userEvent.setup();
    render(<DiscoverShuffleButton />);

    await user.click(screen.getByRole("button", { name: "Shuffle games" }));

    expect(mockPush).toHaveBeenCalled();
  });
});
