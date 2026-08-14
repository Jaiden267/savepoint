import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const { mockRecordRecommendationImpressionsAction } = vi.hoisted(() => ({
  mockRecordRecommendationImpressionsAction: vi.fn(),
}));

vi.mock("@/server/actions/recommendations", () => ({
  recordRecommendationImpressionsAction:
    mockRecordRecommendationImpressionsAction,
}));

import { RecommendationImpressionTracker } from "./recommendation-impression-tracker";

beforeEach(() => {
  mockRecordRecommendationImpressionsAction.mockReset();
  mockRecordRecommendationImpressionsAction.mockResolvedValue(undefined);
});

describe("RecommendationImpressionTracker", () => {
  it("renders nothing", () => {
    const { container } = render(
      <RecommendationImpressionTracker igdbIds={[1, 2, 3]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("fires the impression action once with the given igdb ids, after mount", async () => {
    render(<RecommendationImpressionTracker igdbIds={[1, 2, 3]} />);
    expect(mockRecordRecommendationImpressionsAction).toHaveBeenCalledTimes(1);
    expect(mockRecordRecommendationImpressionsAction).toHaveBeenCalledWith([
      1, 2, 3,
    ]);
  });

  it("does not fire when given an empty array", () => {
    render(<RecommendationImpressionTracker igdbIds={[]} />);
    expect(mockRecordRecommendationImpressionsAction).not.toHaveBeenCalled();
  });

  it("a rejected action never throws out of the component", async () => {
    mockRecordRecommendationImpressionsAction.mockRejectedValue(
      new Error("network down"),
    );
    expect(() =>
      render(<RecommendationImpressionTracker igdbIds={[1]} />),
    ).not.toThrow();
  });
});
