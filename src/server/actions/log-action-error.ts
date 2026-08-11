import "server-only";

const MAX_MESSAGE_LENGTH = 300;

interface DatabaseError {
  code?: string;
  message?: string;
  hint?: string | null;
}

/**
 * The only place any Server Action logs a database error. Server-side only
 * (terminal / container logs) — never returned to the browser, and never
 * changes the friendly message an action already returns.
 *
 * Logs an allow-listed action label (a literal string the caller passes,
 * never derived from user input) plus exactly `code`/`message`/`hint` off
 * the PostgREST error. `message` is truncated as a hard cap against
 * anything unexpectedly large. `error.details` is deliberately never read
 * — for a unique-violation, Postgres's DETAIL text echoes the actual
 * conflicting row values (e.g. the row's own user_id/game_id), which is
 * exactly the kind of incidental data this must stay clear of. Never logs
 * form payloads, review/diary/comment bodies, emails, cookies, tokens,
 * headers, or env values.
 */
export function logActionError(action: string, error: DatabaseError): void {
  console.error("[action-error]", {
    action,
    code: error.code ?? "unknown",
    message: (error.message ?? "").slice(0, MAX_MESSAGE_LENGTH),
    hint: error.hint ?? null,
  });
}
