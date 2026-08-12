import { describe, it, expect } from "vitest";
import { Errors } from "@pinecone-database/pinecone";
import { sanitizeErrorForStorage } from "./error-sanitizer";

describe("sanitizeErrorForStorage", () => {
  it("classifies a PineconeNotFoundError without leaking its message/url", () => {
    const err = new Errors.PineconeNotFoundError({
      status: 404,
      url: "https://secret-host.pinecone.io/indexes/foo?api_key=SECRETVALUE1234567890",
    });
    const result = sanitizeErrorForStorage(err);
    expect(result).toBe("pinecone: not found");
    expect(result).not.toContain("secret-host");
    expect(result).not.toContain("SECRETVALUE1234567890");
  });

  it("classifies a PineconeAuthorizationError generically, never echoing its message (which embeds a URL)", () => {
    const err = new Errors.PineconeAuthorizationError({
      status: 401,
      url: "https://api.pinecone.io/some/path?token=abc",
    });
    const result = sanitizeErrorForStorage(err);
    expect(result).toBe("pinecone: unauthorized");
    expect(result).not.toContain("api.pinecone.io");
    expect(result).not.toContain("token=abc");
  });

  it("classifies a PineconeUnavailableError and a PineconeTimeoutError distinctly", () => {
    expect(
      sanitizeErrorForStorage(
        new Errors.PineconeUnavailableError({ status: 503 }),
      ),
    ).toBe("pinecone: service unavailable");
    expect(
      sanitizeErrorForStorage(new Errors.PineconeTimeoutError("idx", 8000)),
    ).toBe("pinecone: timeout");
  });

  it("falls back to a static label for an unrecognized error, with zero interpolated content", () => {
    const err = new Error(
      "some unexpected failure with Api-Key: abcdefghijklmnopqrstuvwxyz1234567890 embedded",
    );
    expect(sanitizeErrorForStorage(err)).toBe("unclassified sync error");
  });

  it("classifies a Supabase/PostgREST-style error by its short code only, dropping other fields", () => {
    const err = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: "Key (game_id)=(secret-uuid) already exists.",
    };
    const result = sanitizeErrorForStorage(err);
    expect(result).toBe("database error (code 23505)");
    expect(result).not.toContain("secret-uuid");
  });

  it("always stays at or under 200 characters", () => {
    const err = new Error("x".repeat(10000));
    expect(sanitizeErrorForStorage(err).length).toBeLessThanOrEqual(200);
  });

  it("never throws for a non-Error, non-object input", () => {
    expect(() => sanitizeErrorForStorage("plain string error")).not.toThrow();
    expect(() => sanitizeErrorForStorage(null)).not.toThrow();
    expect(() => sanitizeErrorForStorage(undefined)).not.toThrow();
  });
});
