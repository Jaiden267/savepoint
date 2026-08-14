import { describe, it, expect } from "vitest";
import {
  recommendationFeedbackEventTypeSchema,
  recommendationIgdbIdSchema,
  recommendationImpressionBatchSchema,
  recommendationGenreHintsSchema,
} from "./recommendations";

describe("recommendationFeedbackEventTypeSchema", () => {
  it("accepts the three toggleable types", () => {
    for (const type of ["saved", "dismissed", "completed"]) {
      expect(
        recommendationFeedbackEventTypeSchema.safeParse(type).success,
      ).toBe(true);
    }
  });

  it("rejects the telemetry-only types — a client can never claim shown/clicked", () => {
    for (const type of ["shown", "clicked"]) {
      expect(
        recommendationFeedbackEventTypeSchema.safeParse(type).success,
      ).toBe(false);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(
      recommendationFeedbackEventTypeSchema.safeParse("whatever").success,
    ).toBe(false);
  });
});

describe("recommendationIgdbIdSchema", () => {
  it("accepts a positive integer, coerced from a string", () => {
    expect(recommendationIgdbIdSchema.safeParse("123").success).toBe(true);
    expect(recommendationIgdbIdSchema.parse("123")).toBe(123);
  });

  it("rejects zero, negative, and non-numeric values", () => {
    for (const value of [0, -1, "not-a-number", null, undefined]) {
      expect(recommendationIgdbIdSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("recommendationImpressionBatchSchema", () => {
  it("dedupes the array", () => {
    expect(recommendationImpressionBatchSchema.parse([1, 1, 2])).toEqual([
      1, 2,
    ]);
  });

  it("rejects a batch over the cap", () => {
    const tooMany = Array.from({ length: 41 }, (_, i) => i + 1);
    expect(recommendationImpressionBatchSchema.safeParse(tooMany).success).toBe(
      false,
    );
  });

  it("accepts an empty array", () => {
    expect(recommendationImpressionBatchSchema.parse([])).toEqual([]);
  });

  it("rejects non-positive entries", () => {
    expect(recommendationImpressionBatchSchema.safeParse([0, -1]).success).toBe(
      false,
    );
  });
});

describe("recommendationGenreHintsSchema", () => {
  it("accepts an empty array and undefined", () => {
    expect(recommendationGenreHintsSchema.safeParse([]).success).toBe(true);
    expect(recommendationGenreHintsSchema.safeParse(undefined).success).toBe(
      true,
    );
  });

  it("rejects more than 5 hints", () => {
    expect(
      recommendationGenreHintsSchema.safeParse(["a", "b", "c", "d", "e", "f"])
        .success,
    ).toBe(false);
  });
});
