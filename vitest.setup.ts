import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Accessibility test assertions use src/test/axe.ts's expectNoAxeViolations
// helper rather than vitest-axe's own toHaveNoViolations() matcher — that
// matcher's type declarations target a pre-Vitest-4 global namespace that
// doesn't merge with this project's Vitest 4, confirmed by an isolated
// repro (see src/test/axe.ts for detail). vitest-axe is still used for its
// `axe()` scan runner, which has no such type issue.

// "server-only" throws unconditionally when imported outside Next's own
// bundler (which special-cases it to a no-op on the server, and an error
// only in a client bundle). Stub it to a no-op here so server-only modules
// are unit-testable in plain Vitest — this matches its real server-side
// runtime behavior; it says nothing about client-bundle safety, which is
// enforced by the Next.js build itself, not by tests.
vi.mock("server-only", () => ({}));

// `after()` throws "called outside a request scope" unless invoked during a
// real Next.js request — which unit tests never provide. Stub it to a no-op
// (never invoking the callback, matching the fact that these callbacks are
// always wrapped in their own `.catch()` and are explicitly best-effort) so
// code paths that call `after()` stay unit-testable. Preserves every other
// `next/server` export (NextRequest/NextResponse, used directly by several
// route-handler tests) via importOriginal.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});
