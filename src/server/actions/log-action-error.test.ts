import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logActionError } from "./log-action-error";

describe("logActionError", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("logs only the allow-listed keys: action, code, message, hint", () => {
    logActionError("setGameStatusAction:update", {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      hint: "Try a different value.",
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [, payload] = consoleErrorSpy.mock.calls[0] as [string, unknown];
    expect(Object.keys(payload as object).sort()).toEqual(
      ["action", "code", "hint", "message"].sort(),
    );
    expect(payload).toEqual({
      action: "setGameStatusAction:update",
      code: "23505",
      message: "duplicate key value violates unique constraint",
      hint: "Try a different value.",
    });
  });

  it("truncates an overly long message", () => {
    const longMessage = "x".repeat(1000);
    logActionError("deleteReviewAction", {
      code: "P0001",
      message: longMessage,
    });

    const [, payload] = consoleErrorSpy.mock.calls[0] as [
      string,
      { message: string },
    ];
    expect(payload.message.length).toBe(300);
    expect(payload.message).toBe("x".repeat(300));
  });

  it("never reads or logs error.details, even when present on the input", () => {
    const errorWithDetails = {
      code: "23505",
      message: "duplicate key value",
      hint: null,
      details:
        "Key (user_id, game_id)=(11111111-1111-1111-1111-111111111111, 2) already exists.",
    };

    logActionError("setGameStatusAction:insert", errorWithDetails);

    const [, payload] = consoleErrorSpy.mock.calls[0] as [string, unknown];
    expect(JSON.stringify(payload)).not.toContain("11111111");
    expect(Object.keys(payload as object)).not.toContain("details");
  });

  it("defaults missing code/message/hint to safe placeholders", () => {
    logActionError("createReviewAction", {});

    const [, payload] = consoleErrorSpy.mock.calls[0] as [string, unknown];
    expect(payload).toEqual({
      action: "createReviewAction",
      code: "unknown",
      message: "",
      hint: null,
    });
  });
});
