import { describe, it, expect } from "vitest";
import {
  requiredStarsFieldSchema,
  optionalStarsFieldSchema,
  uuidSchema,
} from "./common";

describe("requiredStarsFieldSchema", () => {
  it("accepts a valid FormData string and converts it to a number", () => {
    const result = requiredStarsFieldSchema.safeParse("3.5");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(3.5);
  });

  it("rejects missing (null) input — a rating is required", () => {
    expect(requiredStarsFieldSchema.safeParse(null).success).toBe(false);
  });

  it("rejects empty string input", () => {
    expect(requiredStarsFieldSchema.safeParse("").success).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(requiredStarsFieldSchema.safeParse("0").success).toBe(false);
    expect(requiredStarsFieldSchema.safeParse("5.5").success).toBe(false);
    expect(requiredStarsFieldSchema.safeParse("6").success).toBe(false);
  });

  it("rejects non-multiple-of-0.5 values", () => {
    expect(requiredStarsFieldSchema.safeParse("3.3").success).toBe(false);
  });

  it("rejects non-numeric garbage without silently coercing it", () => {
    expect(requiredStarsFieldSchema.safeParse("abc").success).toBe(false);
    expect(requiredStarsFieldSchema.safeParse("NaN").success).toBe(false);
  });
});

describe("optionalStarsFieldSchema", () => {
  it("converts a missing/empty field to null instead of failing", () => {
    expect(optionalStarsFieldSchema.safeParse(null)).toEqual({
      success: true,
      data: null,
    });
    expect(optionalStarsFieldSchema.safeParse("")).toEqual({
      success: true,
      data: null,
    });
  });

  it("accepts a valid star value", () => {
    const result = optionalStarsFieldSchema.safeParse("4.5");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(4.5);
  });

  it("still rejects invalid non-empty input rather than defaulting to null", () => {
    expect(optionalStarsFieldSchema.safeParse("abc").success).toBe(false);
    expect(optionalStarsFieldSchema.safeParse("6").success).toBe(false);
    expect(optionalStarsFieldSchema.safeParse("3.3").success).toBe(false);
  });
});

describe("uuidSchema", () => {
  it("accepts a well-formed uuid", () => {
    expect(
      uuidSchema.safeParse("4dd1ceb8-3446-4167-a4b7-174a8e9e0a58").success,
    ).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
