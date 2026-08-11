import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  diaryPlayedOnSchema,
  diaryNoteSchema,
  logDiaryEntrySchema,
  updateDiaryEntrySchema,
  deleteDiaryEntrySchema,
} from "./diary";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const entryId = "5ee2dfc9-4557-5278-b5c8-285b9f0f1b69";
const gameSlug = "the-legend-of-zelda";

describe("diaryPlayedOnSchema", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts an old date — no lower bound", () => {
    expect(diaryPlayedOnSchema.safeParse("1998-11-23").success).toBe(true);
  });

  it("accepts today", () => {
    expect(diaryPlayedOnSchema.safeParse("2026-08-11").success).toBe(true);
  });

  it("rejects a date further in the future than the timezone-slack window", () => {
    expect(diaryPlayedOnSchema.safeParse("2026-08-20").success).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(diaryPlayedOnSchema.safeParse("not-a-date").success).toBe(false);
    expect(diaryPlayedOnSchema.safeParse("08/11/2026").success).toBe(false);
  });
});

describe("diaryNoteSchema", () => {
  it("normalizes an empty string to null — this note is PUBLIC, not private", () => {
    expect(diaryNoteSchema.safeParse("")).toEqual({
      success: true,
      data: null,
    });
  });

  it("accepts a normal note", () => {
    const result = diaryNoteSchema.safeParse("Great replay!");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Great replay!");
  });

  it("rejects a note over 2000 characters", () => {
    expect(diaryNoteSchema.safeParse("a".repeat(2001)).success).toBe(false);
  });
});

describe("logDiaryEntrySchema", () => {
  it("accepts a full valid payload with an optional rating omitted", () => {
    const result = logDiaryEntrySchema.safeParse({
      gameId,
      gameSlug,
      playedOn: "2020-01-01",
      rating: null,
      isReplay: false,
      note: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid optional rating", () => {
    const result = logDiaryEntrySchema.safeParse({
      gameId,
      gameSlug,
      playedOn: "2020-01-01",
      rating: "4",
      isReplay: true,
      note: "Replayed for the anniversary.",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rating).toBe(4);
  });
});

describe("updateDiaryEntrySchema", () => {
  it("never accepts a gameId field — game_id must never be reassignable", () => {
    const parsed = updateDiaryEntrySchema.safeParse({
      entryId,
      gameSlug,
      playedOn: "2020-01-01",
      rating: null,
      isReplay: false,
      note: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("gameId" in parsed.data).toBe(false);
    }
  });
});

describe("deleteDiaryEntrySchema", () => {
  it("accepts a valid entryId/gameSlug pair", () => {
    expect(
      deleteDiaryEntrySchema.safeParse({ entryId, gameSlug }).success,
    ).toBe(true);
  });
});
