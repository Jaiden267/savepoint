import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";
import type { RecommendationResult } from "@/server/services/recommendations";

const { mockToggleRecommendationFeedbackAction } = vi.hoisted(() => ({
  mockToggleRecommendationFeedbackAction: vi.fn(),
}));

vi.mock("@/server/actions/recommendations", () => ({
  toggleRecommendationFeedbackAction: mockToggleRecommendationFeedbackAction,
  importRecommendedCatalogueGameAction: vi.fn(),
}));

import { RecommendationCard } from "./recommendation-card";

const localResult: RecommendationResult = {
  source: "local",
  igdbId: 100,
  slug: "some-game",
  name: "Some Game",
  coverImageId: null,
  releaseYear: 2020,
  gameType: null,
  versionParentIgdbId: null,
  reason: "Matches your preference for RPG",
};

const catalogueResult: RecommendationResult = {
  ...localResult,
  source: "igdb",
  igdbId: 200,
  slug: "catalogue-game",
  name: "Catalogue Game",
  reason: "Because you rated Some Game highly",
};

beforeEach(() => {
  mockToggleRecommendationFeedbackAction.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecommendationCard", () => {
  it("renders the reason text", () => {
    render(<RecommendationCard result={localResult} />);
    expect(
      screen.getByText("Matches your preference for RPG"),
    ).toBeInTheDocument();
  });

  it("renders a real <Link> for a local (cached) result — no navigation is intercepted", () => {
    render(<RecommendationCard result={localResult} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/games/some-game",
    );
  });

  it("renders the import <form>/<button> for a catalogue-only (igdb) result", () => {
    render(<RecommendationCard result={catalogueResult} />);
    expect(
      screen.getByRole("button", { name: /import and open catalogue game/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("fires sendBeacon on click of a local result, without preventing navigation", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    const user = userEvent.setup();
    render(<RecommendationCard result={localResult} />);
    await user.click(screen.getByRole("link"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe("/api/recommendations/click");
    expect(body.type).toBe("application/json");
  });

  it("falls back to fetch(keepalive) when sendBeacon returns false", async () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<RecommendationCard result={localResult} />);
    await user.click(screen.getByRole("link"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recommendations/click",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
  });

  it("falls back to fetch(keepalive) when sendBeacon doesn't exist at all", async () => {
    const navWithoutBeacon = { ...navigator };
    // @ts-expect-error -- simulating an older browser with no sendBeacon
    delete navWithoutBeacon.sendBeacon;
    vi.stubGlobal("navigator", navWithoutBeacon);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<RecommendationCard result={localResult} />);
    await user.click(screen.getByRole("link"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recommendations/click",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
  });

  it("a telemetry failure never throws or blocks — click handler swallows it", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      sendBeacon: () => {
        throw new Error("boom");
      },
    });
    const user = userEvent.setup();
    render(<RecommendationCard result={localResult} />);
    await expect(user.click(screen.getByRole("link"))).resolves.not.toThrow();
  });

  it("renders the feedback buttons alongside the result", () => {
    render(<RecommendationCard result={localResult} />);
    expect(screen.getByRole("button", { name: "Helpful" })).toBeInTheDocument();
  });

  it("has no axe violations for a local result", async () => {
    const { container } = render(<RecommendationCard result={localResult} />);
    expectNoAxeViolations(await axe(container));
  });

  it("has no axe violations for a catalogue-only result", async () => {
    const { container } = render(
      <RecommendationCard result={catalogueResult} />,
    );
    expectNoAxeViolations(await axe(container));
  });
});
