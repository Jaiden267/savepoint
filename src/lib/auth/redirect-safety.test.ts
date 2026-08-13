import { describe, it, expect } from "vitest";
import { isSafeRedirectPath, safeRedirectPath } from "./redirect-safety";

describe("isSafeRedirectPath", () => {
  it("accepts root-relative paths", () => {
    expect(isSafeRedirectPath("/settings/profile")).toBe(true);
    expect(isSafeRedirectPath("/")).toBe(true);
    expect(isSafeRedirectPath("/users/foo?tab=lists")).toBe(true);
  });

  it("rejects absolute URLs to another origin", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
    expect(isSafeRedirectPath("http://evil.com/phish")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
  });

  it("rejects an embedded scheme anywhere in the path", () => {
    expect(isSafeRedirectPath("/redirect?to=javascript://evil")).toBe(false);
  });
  it("rejects backslash-based bypasses some browsers/proxies normalize toward //evil.com", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\\/evil.com")).toBe(false);
    expect(isSafeRedirectPath("/settings\\..\\evil.com")).toBe(false);
  });

  it("rejects empty, null, and undefined input", () => {
    expect(isSafeRedirectPath("")).toBe(false);
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
  });

  it("rejects a path that doesn't start with a slash", () => {
    expect(isSafeRedirectPath("settings/profile")).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("returns the path when safe", () => {
    expect(safeRedirectPath("/onboarding", "/")).toBe("/onboarding");
  });

  it("returns the fallback when unsafe", () => {
    expect(safeRedirectPath("https://evil.com", "/")).toBe("/");
    expect(safeRedirectPath(null, "/")).toBe("/");
  });
});
