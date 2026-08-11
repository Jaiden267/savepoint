import { describe, it, expect } from "vitest";
import {
  usernameSchema,
  passwordSchema,
  emailSchema,
  displayNameSchema,
  bioSchema,
  signUpSchema,
  resetPasswordSchema,
  profileFormSchema,
  avatarFileSchema,
  AVATAR_MAX_BYTES,
} from "./auth";

describe("usernameSchema", () => {
  it("accepts valid usernames matching the DB constraint", () => {
    for (const value of ["abc", "abc_123", "A".repeat(30), "user_name"]) {
      expect(usernameSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects usernames the DB CHECK constraint would reject", () => {
    for (const value of [
      "ab", // too short
      "a".repeat(31), // too long
      "has space",
      "has-dash",
      "has.dot",
      "emoji😀",
      "",
    ]) {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    }
  });

  it("trims surrounding whitespace before validating", () => {
    const result = usernameSchema.safeParse("  valid_name  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("valid_name");
  });
});

describe("passwordSchema", () => {
  it("accepts an 8-72 character password", () => {
    expect(passwordSchema.safeParse("a".repeat(8)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(72)).success).toBe(true);
  });

  it("rejects passwords outside 8-72 characters", () => {
    expect(passwordSchema.safeParse("a".repeat(7)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(73)).success).toBe(false);
  });
});

describe("emailSchema", () => {
  it("accepts a well-formed email", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("displayNameSchema / bioSchema", () => {
  it("normalizes an empty string to null", () => {
    expect(displayNameSchema.parse("")).toBeNull();
    expect(bioSchema.parse("")).toBeNull();
  });

  it("passes null through unchanged", () => {
    expect(displayNameSchema.parse(null)).toBeNull();
  });

  it("enforces max length matching the DB CHECK constraints", () => {
    expect(displayNameSchema.safeParse("a".repeat(80)).success).toBe(true);
    expect(displayNameSchema.safeParse("a".repeat(81)).success).toBe(false);
    expect(bioSchema.safeParse("a".repeat(500)).success).toBe(true);
    expect(bioSchema.safeParse("a".repeat(501)).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("requires matching passwords", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      confirmPassword: "different123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });

  it("accepts matching, valid input", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      confirmPassword: "password123",
    });
    expect(result.success).toBe(true);
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "password123",
        confirmPassword: "nope",
      }).success,
    ).toBe(false);
  });
});

describe("profileFormSchema", () => {
  it("accepts a minimal valid submission", () => {
    const result = profileFormSchema.safeParse({
      username: "new_user",
      displayName: "",
      bio: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBeNull();
      expect(result.data.bio).toBeNull();
    }
  });

  it("rejects an invalid username even with valid optional fields", () => {
    const result = profileFormSchema.safeParse({
      username: "x",
      displayName: "Fine",
      bio: "Also fine",
    });
    expect(result.success).toBe(false);
  });
});

describe("avatarFileSchema", () => {
  it("accepts a valid PNG within the size limit", () => {
    const file = new File([new Uint8Array(10)], "avatar.png", {
      type: "image/png",
    });
    expect(avatarFileSchema.safeParse(file).success).toBe(true);
  });

  it("rejects a file over the size limit", () => {
    const file = new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], "big.png", {
      type: "image/png",
    });
    expect(avatarFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects a disallowed mime type", () => {
    const file = new File([new Uint8Array(10)], "avatar.gif", {
      type: "image/gif",
    });
    expect(avatarFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects an empty file", () => {
    const file = new File([], "empty.png", { type: "image/png" });
    expect(avatarFileSchema.safeParse(file).success).toBe(false);
  });
});
