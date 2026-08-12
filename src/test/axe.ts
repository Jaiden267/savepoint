import { expect } from "vitest";
import type { AxeResults, Result } from "axe-core";

/**
 * Asserts an axe-core scan found no violations, with a readable failure
 * message. Written as a plain typed helper instead of vitest-axe's
 * `toHaveNoViolations()` matcher: that matcher's type declarations augment
 * a pre-Vitest-4 `Vi.Assertion` global namespace that no longer merges with
 * Vitest 4's actual `Assertion<T>` interface (confirmed empirically — the
 * runtime matcher itself still works via `expect.extend`, but `tsc` cannot
 * see it, and a from-scratch `declare module "@vitest/expect"` augmentation
 * doesn't merge with this version's bundled `.d.ts` either). Using the raw
 * `axe-core` results directly avoids depending on that broken type surface.
 */
export function expectNoAxeViolations(results: AxeResults): void {
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}

function formatViolations(violations: Result[]): string {
  if (violations.length === 0) return "";
  return violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.length} node(s)) — ${violation.helpUrl}`,
    )
    .join("\n");
}
