import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

import { RecommendationsRegenerateButton } from "./recommendations-regenerate-button";

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams();
});

describe("RecommendationsRegenerateButton", () => {
  it("clicking navigates to /recommendations?seed=<number> via router.push", async () => {
    const user = userEvent.setup();
    render(<RecommendationsRegenerateButton />);

    await user.click(screen.getByRole("button", { name: /regenerate/i }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/^\/recommendations\?seed=\d+$/);
  });

  it("carries forward an existing ?genres= hint from the current URL", async () => {
    mockSearchParams = new URLSearchParams("genres=rpg%2Cstealth");
    const user = userEvent.setup();
    render(<RecommendationsRegenerateButton />);

    await user.click(screen.getByRole("button", { name: /regenerate/i }));

    const url = mockPush.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/^\/recommendations\?seed=\d+&genres=rpg%2Cstealth$/);
  });

  it("omits the genres param entirely when none was present", async () => {
    const user = userEvent.setup();
    render(<RecommendationsRegenerateButton />);

    await user.click(screen.getByRole("button", { name: /regenerate/i }));

    const url = mockPush.mock.calls[0]?.[0] as string;
    expect(url).not.toContain("genres");
  });

  it("two separate clicks produce two different seeds", async () => {
    const user = userEvent.setup();
    render(<RecommendationsRegenerateButton />);

    await user.click(screen.getByRole("button", { name: /regenerate/i }));
    await user.click(screen.getByRole("button", { name: /regenerate/i }));

    const seeds = mockPush.mock.calls.map((call) => call[0] as string);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it("uses router.push (not replace) so regeneration history is preserved", async () => {
    const user = userEvent.setup();
    render(<RecommendationsRegenerateButton />);

    await user.click(screen.getByRole("button", { name: /regenerate/i }));

    expect(mockPush).toHaveBeenCalled();
  });
});
