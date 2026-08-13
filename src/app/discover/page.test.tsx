import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockRedirect, mockRouterPush } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockRouterPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: mockRouterPush }),
}));

import DiscoverPage, { metadata } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("DiscoverPage — seed validation and canonicalizing redirect", () => {
  it("redirects to a fresh seeded URL when no seed param is present", async () => {
    await expect(
      DiscoverPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/^REDIRECT:/);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/^\/discover\?seed=\d+$/);
  });

  it("redirects to a fresh seeded URL when the seed param is invalid (non-numeric)", async () => {
    await expect(
      DiscoverPage({
        searchParams: Promise.resolve({ seed: "not-a-number" }),
      }),
    ).rejects.toThrow(/^REDIRECT:/);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });

  it("redirects when the seed is out of the 32-bit unsigned range", async () => {
    await expect(
      DiscoverPage({
        searchParams: Promise.resolve({ seed: "99999999999999" }),
      }),
    ).rejects.toThrow(/^REDIRECT:/);
  });

  it("does not redirect when a valid seed param is present", async () => {
    const jsx = await DiscoverPage({
      searchParams: Promise.resolve({ seed: "123" }),
    });
    render(jsx);

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("renders the shuffle button, reachable from PageHeader's action slot, for a valid seed", async () => {
    const jsx = await DiscoverPage({
      searchParams: Promise.resolve({ seed: "123" }),
    });
    render(jsx);

    expect(
      screen.getByRole("button", { name: "Shuffle games" }),
    ).toBeInTheDocument();
  });
});

describe("DiscoverPage — canonical metadata", () => {
  it("declares /discover as canonical regardless of the seed in the URL", () => {
    expect(metadata.alternates).toMatchObject({ canonical: "/discover" });
  });
});
