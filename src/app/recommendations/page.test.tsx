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
  useSearchParams: () => new URLSearchParams(),
}));

import RecommendationsPage, { metadata } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("RecommendationsPage — seed validation and canonicalizing redirect", () => {
  it("redirects to a fresh seeded URL when no seed param is present", async () => {
    await expect(
      RecommendationsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/^REDIRECT:/);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/^\/recommendations\?seed=\d+$/);
  });

  it("redirects to a fresh seeded URL when the seed param is invalid", async () => {
    await expect(
      RecommendationsPage({
        searchParams: Promise.resolve({ seed: "not-a-number" }),
      }),
    ).rejects.toThrow(/^REDIRECT:/);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });

  it("preserves an existing ?genres= hint across the canonicalizing redirect", async () => {
    await expect(
      RecommendationsPage({
        searchParams: Promise.resolve({ genres: "rpg,stealth" }),
      }),
    ).rejects.toThrow(/^REDIRECT:/);

    const url = mockRedirect.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/^\/recommendations\?seed=\d+&genres=rpg%2Cstealth$/);
  });

  it("does not redirect when a valid seed param is present", async () => {
    const jsx = await RecommendationsPage({
      searchParams: Promise.resolve({ seed: "123" }),
    });
    render(jsx);

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("renders the regenerate button, reachable from PageHeader's action slot", async () => {
    const jsx = await RecommendationsPage({
      searchParams: Promise.resolve({ seed: "123" }),
    });
    render(jsx);

    expect(
      screen.getByRole("button", { name: /regenerate/i }),
    ).toBeInTheDocument();
  });
});

describe("RecommendationsPage — canonical metadata", () => {
  it("declares /recommendations as canonical regardless of the seed/genres in the URL", () => {
    expect(metadata.alternates).toMatchObject({
      canonical: "/recommendations",
    });
  });
});
