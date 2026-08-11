// Deliberately NOT `server-only` — pure string normalization, no secrets, no
// network access. scripts/igdb-smoke-test.mts (a plain Node script outside
// Next's bundler) imports this directly; see apicalypse.ts's header comment
// for why that matters.

// Built via RegExp(...) with an escaped unicode range, rather than a /.../
// literal, to avoid any editor/tooling risk of the escape sequence being
// silently decoded into a literal combining character in the source file.
const COMBINING_DIACRITICAL_MARKS = new RegExp("[\\u0300-\\u036f]", "g");
const NON_ALPHANUMERIC = /[^\p{L}\p{N}\s]/gu;
const EXTRA_WHITESPACE = /\s+/g;

/**
 * Normalizes a game name for comparison: lowercase, diacritics stripped,
 * punctuation replaced with spaces, whitespace collapsed and trimmed.
 * E.g. "Pokemon: Let's Go, Pikachu!" (with an accented e) normalizes to
 * "pokemon lets go pikachu".
 */
export function normalizeGameName(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICAL_MARKS, "")
    .replace(NON_ALPHANUMERIC, " ")
    .replace(EXTRA_WHITESPACE, " ")
    .trim();
}
