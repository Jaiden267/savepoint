import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// "server-only" throws unconditionally when imported outside Next's own
// bundler (which special-cases it to a no-op on the server, and an error
// only in a client bundle). Stub it to a no-op here so server-only modules
// are unit-testable in plain Vitest — this matches its real server-side
// runtime behavior; it says nothing about client-bundle safety, which is
// enforced by the Next.js build itself, not by tests.
vi.mock("server-only", () => ({}));
