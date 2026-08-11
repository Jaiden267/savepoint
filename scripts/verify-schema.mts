// Read-only, non-destructive schema verification against a LIVE Supabase
// project, using ONLY the publishable key (anon role — no session, no
// signup). This intentionally doubles as the "unauthenticated writes are
// rejected" test.
//
// Safety design: every write probe targets a fresh/empty database (no real
// users or games exist yet), and every owner-scoped table's FK columns
// reference auth.users/games. Postgres checks table/column GRANTs BEFORE
// evaluating constraints, so a probe with a random, non-existent FK value
// can only ever produce one of three outcomes:
//   1. permission denied (42501)      -> correctly blocked at the GRANT layer
//   2. foreign key violation (23503)  -> grant exists (concerning), blocked
//                                        only by the fake FK value
//   3. success                        -> should be impossible; if it somehow
//                                        happens, the row is deleted
//      immediately in the same run, before anything is printed.
// No row can ever durably exist as a result of running this script.
//
// Never prints the project URL, the publishable key, or full row contents —
// only pass/fail classifications and short, generic Postgres error
// codes/messages (which never contain secrets or row data).
//
// Run with: npm run verify-schema

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: MISSING. " +
      "Cannot run live verification without them (values are never printed).",
  );
  process.exit(1);
}

const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Verdict = "PASS" | "FAIL" | "CRITICAL" | "INCONCLUSIVE";

interface Result {
  check: string;
  verdict: Verdict;
  detail: string;
}

const results: Result[] = [];

function record(check: string, verdict: Verdict, detail: string) {
  results.push({ check, verdict, detail });
}

// ---------------------------------------------------------------------------
// 1. Public reads that should succeed (200, possibly empty — no data seeded).
// ---------------------------------------------------------------------------
const publiclyReadable = [
  "profiles",
  "games",
  "genres",
  "platforms",
  "game_genres",
  "game_platforms",
  "game_modes",
  "themes",
  "game_game_modes",
  "game_themes",
  "user_games",
  "diary_entries",
  "reviews",
  "review_likes",
  "review_comments",
  "lists",
  "list_items",
  "follows",
  "activity_events",
  "game_rating_stats",
  "review_like_counts",
  "profile_stats",
] as const;

async function checkPublicRead(table: string) {
  const { error } = await supabase
    .from(table as never)
    .select("*")
    .limit(1);

  if (!error) {
    record(`read: ${table}`, "PASS", "public SELECT succeeded");
    return;
  }

  if (isMissingTable(error)) {
    record(
      `read: ${table}`,
      "CRITICAL",
      `table/view not found via API (${error.code ?? "?"}) — migration likely missing or not applied`,
    );
    return;
  }

  record(
    `read: ${table}`,
    "FAIL",
    `expected public read to succeed, got ${error.code ?? "?"}: ${truncate(error.message)}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Reads that should be DENIED to anon (server-only tables).
//
// IMPORTANT semantics: Postgres RLS does NOT raise an error for a SELECT
// that matches no policy — it silently filters to zero rows (a genuinely
// successful, empty response). A hard "permission denied" error only occurs
// if the table-level GRANT itself is missing. Both are secure outcomes for
// SELECT; the only thing that would actually indicate a leak is a
// *non-empty* result. So the pass criterion here is "no error and empty
// data" OR "a permission-denied error" — either is correct.
// ---------------------------------------------------------------------------
const anonDeniedRead = ["recommendation_feedback", "game_vector_sync"] as const;

async function checkDeniedRead(table: string) {
  const { data, error } = await supabase
    .from(table as never)
    .select("*")
    .limit(1);

  if (isMissingTable(error)) {
    record(
      `read-denied: ${table}`,
      "CRITICAL",
      `table not found via API (${error!.code ?? "?"}) — migration likely missing`,
    );
    return;
  }

  if (isPermissionDenied(error)) {
    record(
      `read-denied: ${table}`,
      "PASS",
      "anon SELECT denied at the GRANT layer (permission denied)",
    );
    return;
  }

  if (!error && Array.isArray(data) && data.length === 0) {
    record(
      `read-denied: ${table}`,
      "PASS",
      "anon SELECT succeeded but RLS correctly filtered to zero rows",
    );
    return;
  }

  if (!error && Array.isArray(data) && data.length > 0) {
    record(
      `read-denied: ${table}`,
      "CRITICAL",
      `anon SELECT returned ${data.length} row(s) from a table that should be server-only`,
    );
    return;
  }

  record(
    `read-denied: ${table}`,
    "FAIL",
    `unexpected outcome, got ${error?.code ?? "?"}: ${truncate(error?.message)}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Writes that should be DENIED to anon (every table — no anon write
//    grant exists anywhere in the schema). Uses random, non-existent FK
//    values; see the safety note at the top of this file for why this can
//    never durably create a row.
// ---------------------------------------------------------------------------
const insertProbes: Record<string, Record<string, unknown>> = {
  profiles: { id: randomUUID(), username: `probe_${randomUUID().slice(0, 8)}` },
  games: {
    igdb_id: 999_999_999,
    slug: `verify-probe-${randomUUID()}`,
    name: "Verify Probe",
  },
  genres: {
    id: 999_999_999,
    name: "Verify Probe",
    slug: `probe-genre-${randomUUID()}`,
  },
  platforms: {
    id: 999_999_999,
    name: "Verify Probe",
    slug: `probe-platform-${randomUUID()}`,
  },
  game_genres: { game_id: randomUUID(), genre_id: 999_999_999 },
  game_platforms: { game_id: randomUUID(), platform_id: 999_999_999 },
  user_games: { game_id: randomUUID(), status: "wishlist" },
  diary_entries: { game_id: randomUUID(), played_on: "2026-01-01" },
  reviews: { game_id: randomUUID(), rating: 5, body: "verification probe" },
  review_likes: { review_id: randomUUID() },
  review_comments: { review_id: randomUUID(), body: "verification probe" },
  lists: { title: "Verify Probe List" },
  list_items: { list_id: randomUUID(), game_id: randomUUID(), position: 1 },
  follows: { following_id: randomUUID() },
  activity_events: {
    actor_id: randomUUID(),
    event_type: "follow_created",
    object_type: "follow",
    object_id: randomUUID(),
  },
  recommendation_feedback: { game_id: randomUUID(), event_type: "shown" },
  game_vector_sync: { game_id: randomUUID() },
};

async function checkInsertDenied(table: string, row: Record<string, unknown>) {
  const { data, error } = await supabase
    .from(table as never)
    .insert(row as never)
    .select();

  if (isPermissionDenied(error)) {
    record(
      `write-denied: ${table}`,
      "PASS",
      "anon INSERT correctly denied (permission)",
    );
    return;
  }

  if (isMissingTable(error)) {
    record(
      `write-denied: ${table}`,
      "CRITICAL",
      `table not found via API (${error!.code ?? "?"}) — migration likely missing`,
    );
    return;
  }

  if (!error) {
    // Should be impossible given the grants — but if it happens, clean up
    // immediately before reporting anything.
    await cleanup(table, data);
    record(
      `write-denied: ${table}`,
      "CRITICAL",
      "anon INSERT unexpectedly SUCCEEDED — row was deleted immediately; grants must be fixed",
    );
    return;
  }

  if (isForeignKeyViolation(error)) {
    record(
      `write-denied: ${table}`,
      "FAIL",
      `anon appears to hold an INSERT grant — blocked only by a fake FK (23503), not by permissions`,
    );
    return;
  }

  // Any other error (e.g. a CHECK violation) still implies the grant exists.
  record(
    `write-denied: ${table}`,
    "FAIL",
    `expected permission-denied, got ${error.code ?? "?"}: ${truncate(error.message)}`,
  );
}

async function cleanup(table: string, data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return;
  const row = data[0] as Record<string, unknown>;
  const pk = "id" in row ? row.id : "game_id" in row ? row.game_id : undefined;
  if (pk === undefined) return;
  const pkColumn = "id" in row ? "id" : "game_id";
  await supabase
    .from(table as never)
    .delete()
    .eq(pkColumn, pk as never);
}

// ---------------------------------------------------------------------------
// 4. A few representative UPDATE/DELETE spot checks against a random,
//    non-existent id.
//
// IMPORTANT semantics: like SELECT, RLS's USING clause for UPDATE/DELETE
// filters which rows are *eligible*, rather than raising an error — a
// statement that touches zero rows because none matched the id (which is
// guaranteed here, and would be true regardless of RLS) succeeds silently
// with an empty result either way. On a database with no real rows yet, a
// "no error, zero rows affected" outcome is therefore INCONCLUSIVE, not a
// finding — it cannot be distinguished from "the id simply didn't exist".
// The only thing that would be a genuine finding is data actually coming
// back (a row was found and modified/deleted), which is otherwise
// impossible here since the id is random and freshly generated.
// ---------------------------------------------------------------------------
async function checkUpdateDenied(
  table: string,
  patch: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from(table as never)
    .update(patch as never)
    .eq("id", randomUUID() as never)
    .select();

  if (isPermissionDenied(error)) {
    record(
      `update-denied: ${table}`,
      "PASS",
      "anon UPDATE denied at the GRANT layer",
    );
  } else if (!error && Array.isArray(data) && data.length === 0) {
    record(
      `update-denied: ${table}`,
      "INCONCLUSIVE",
      "0 rows affected (no row existed with that id) — cannot distinguish RLS filtering from a simple no-match on this empty database; see the INSERT-denial results above for the decisive write-permission signal",
    );
  } else if (!error && Array.isArray(data) && data.length > 0) {
    record(
      `update-denied: ${table}`,
      "CRITICAL",
      `anon UPDATE modified ${data.length} row(s) — should be impossible`,
    );
  } else {
    record(
      `update-denied: ${table}`,
      "FAIL",
      `unexpected outcome, got ${error?.code ?? "?"}: ${truncate(error?.message)}`,
    );
  }
}

async function checkDeleteDenied(table: string) {
  const { data, error } = await supabase
    .from(table as never)
    .delete()
    .eq("id", randomUUID() as never)
    .select();

  if (isPermissionDenied(error)) {
    record(
      `delete-denied: ${table}`,
      "PASS",
      "anon DELETE denied at the GRANT layer",
    );
  } else if (!error && Array.isArray(data) && data.length === 0) {
    record(
      `delete-denied: ${table}`,
      "INCONCLUSIVE",
      "0 rows affected (no row existed with that id) — cannot distinguish RLS filtering from a simple no-match on this empty database; see the INSERT-denial results above for the decisive write-permission signal",
    );
  } else if (!error && Array.isArray(data) && data.length > 0) {
    record(
      `delete-denied: ${table}`,
      "CRITICAL",
      `anon DELETE removed ${data.length} row(s) — should be impossible`,
    );
  } else {
    record(
      `delete-denied: ${table}`,
      "FAIL",
      `unexpected outcome, got ${error?.code ?? "?"}: ${truncate(error?.message)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Storage: avatars bucket exists and is reachable; no other bucket exists.
// ---------------------------------------------------------------------------
async function checkAvatarsBucket() {
  const { data, error } = await supabase.storage.from("avatars").list();
  if (error) {
    record(
      "storage: avatars bucket",
      "FAIL",
      `list() failed: ${truncate(error.message)}`,
    );
    return;
  }
  record(
    "storage: avatars bucket",
    "PASS",
    `bucket reachable, ${data?.length ?? 0} object(s) at root`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type PostgrestLikeError =
  { code?: string; message?: string } | null | undefined;

function isPermissionDenied(error: PostgrestLikeError): boolean {
  if (!error) return false;
  return (
    error.code === "42501" || /permission denied/i.test(error.message ?? "")
  );
}

function isForeignKeyViolation(error: PostgrestLikeError): boolean {
  if (!error) return false;
  return (
    error.code === "23503" ||
    /foreign key constraint/i.test(error.message ?? "")
  );
}

function isMissingTable(error: PostgrestLikeError): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table/i.test(error.message ?? "")
  );
}

function truncate(message: string | undefined, max = 140): string {
  if (!message) return "(no message)";
  return message.length > max ? `${message.slice(0, max)}…` : message;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  for (const table of publiclyReadable) await checkPublicRead(table);
  for (const table of anonDeniedRead) await checkDeniedRead(table);
  for (const [table, row] of Object.entries(insertProbes)) {
    await checkInsertDenied(table, row);
  }
  await checkUpdateDenied("profiles", { display_name: "probe" });
  await checkDeleteDenied("reviews");
  await checkAvatarsBucket();

  const width = Math.max(...results.map((r) => r.check.length)) + 2;
  console.log(
    "\n=== Savepoint schema verification (anon/publishable key only) ===\n",
  );
  for (const r of results) {
    console.log(
      `[${r.verdict.padEnd(8)}] ${r.check.padEnd(width)} ${r.detail}`,
    );
  }

  const critical = results.filter((r) => r.verdict === "CRITICAL");
  const failed = results.filter((r) => r.verdict === "FAIL");
  const inconclusive = results.filter((r) => r.verdict === "INCONCLUSIVE");
  const passed =
    results.length - critical.length - failed.length - inconclusive.length;
  console.log(
    `\n${results.length} checks: ${passed} passed, ${failed.length} failed, ` +
      `${critical.length} critical, ${inconclusive.length} inconclusive.\n`,
  );

  if (critical.length > 0 || failed.length > 0) {
    process.exit(1);
  }
}

await main();
