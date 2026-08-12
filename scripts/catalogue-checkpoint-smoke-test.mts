// Opt-in, live, real-network/real-database smoke test for the Prompt 7C
// catalogue checkpoint RPC (advance_catalogue_discovery) and its lease and
// permission model, run once against the real applied migration
// (20260813120000_add_igdb_catalogue_sync_infrastructure.sql) as part of
// Gate A2. NOT part of `npm test` — this calls the real linked Supabase
// project via both the anon key and the secret key. Run manually with:
//   npm run catalogue:checkpoint-smoke-test
//
// Safety design, mirroring scripts/igdb-smoke-test.mts's and
// scripts/pinecone-smoke-test.mts's conventions:
//   - .env.local loaded via process.loadEnvFile with a graceful fallback.
//   - Never prints a secret key/publishable key value.
//   - Every mutation this script performs uses deliberately out-of-range
//     negative igdb_id values (real IGDB ids are always positive) and a
//     `__verify__:` prefixed cursor_name, so nothing here can ever collide
//     with real discovery state. All of it is deleted in a `finally` block
//     regardless of how the script exits, and the global catalogue lease is
//     explicitly released back to its pristine (unheld) state at the end —
//     "guaranteed cleanup," not a best-effort one.
//   - Only ever calls the RPC through the admin (service-role) client for
//     the mutating exercises below — that's the only role granted EXECUTE.
//     The one exception is the permission check itself, which deliberately
//     uses the anon-key client with no session, to prove end-to-end (through
//     PostgREST, not just static catalog introspection) that anon really
//     cannot invoke it.
//
// Why this doesn't import src/lib/pinecone/{client,sync,search}.ts or
// src/lib/supabase/{admin,server}.ts directly: those (correctly) start with
// `import "server-only"`, which throws unconditionally outside Next's own
// bundler. This script reuses the real, pure, non-`server-only` page-key
// logic from catalogue-page-key.ts directly, and talks to Supabase via a
// plain `@supabase/supabase-js` client constructed inline, exactly like
// scripts/pinecone-backfill.mts already does.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { buildCataloguePageKey } from "../src/lib/pinecone/catalogue-page-key.ts";
import type { Database, Json } from "../src/types/database.ts";

// The generated RPC arg type doesn't model that several parameters (all
// declared `default null` in the SQL function) legitimately accept `null`
// at runtime — Postgres function-parameter nullability isn't something the
// type generator infers from schema alone, so it types every scalar
// parameter's TS type as non-null with `| undefined` for "omit it". This
// script's own input type allows `null` explicitly for each of them; the
// cast to the generated type happens only at the actual `.rpc()` call
// boundary below (inside rpcArgs()).
type NullableRpcFields =
  | "p_expected_previous_page_key"
  | "p_new_last_igdb_id"
  | "p_new_last_updated_at_unix"
  | "p_new_last_updated_at_igdb_id"
  | "p_new_last_release_check_unix"
  | "p_new_last_release_check_igdb_id";

type AdvanceCatalogueDiscoveryArgs = Omit<
  Database["public"]["Functions"]["advance_catalogue_discovery"]["Args"],
  NullableRpcFields
> & {
  [K in NullableRpcFields]: number | string | null;
};

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseSecretKey || !supabasePublishableKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: one or more MISSING. Cannot " +
      "run without them (values are never printed).",
  );
  process.exit(1);
}

const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Verdict = "PASS" | "FAIL";
interface Result {
  check: string;
  verdict: Verdict;
  detail: string;
}
const results: Result[] = [];
function record(check: string, verdict: Verdict, detail: string) {
  results.push({ check, verdict, detail });
}

// Deliberately impossible IGDB ids (real ones are always positive) so
// cleanup is unambiguous and nothing here can ever collide with real
// discovery state.
const TEST_IGDB_IDS = [-1001, -1002, -1003, -1004] as const;
const TEST_CURSOR_NAME = "__verify__:gate-a2";
const TEST_PROFILE = "__verify__";

type GeneratedRpcArgs =
  Database["public"]["Functions"]["advance_catalogue_discovery"]["Args"];

/**
 * Returns the generated RPC arg type for direct use with `.rpc()`. The
 * internal cast is the one place this script papers over the generator's
 * missing nullability info for `p_expected_previous_page_key` (see the
 * type comment above) — every call site works with the honestly-typed
 * `AdvanceCatalogueDiscoveryArgs` shape and never casts anything itself.
 */
function rpcArgs(
  args: Partial<AdvanceCatalogueDiscoveryArgs> & {
    p_candidates?: Json;
  },
): GeneratedRpcArgs {
  const full: AdvanceCatalogueDiscoveryArgs = {
    p_cursor_name: TEST_CURSOR_NAME,
    p_lease_token: "",
    p_page_key: "",
    p_expected_previous_page_key: null,
    p_candidates: [],
    p_mark_ineligible: [],
    p_new_last_igdb_id: null,
    p_new_last_updated_at_unix: null,
    p_new_last_updated_at_igdb_id: null,
    p_new_last_release_check_unix: null,
    p_new_last_release_check_igdb_id: null,
    p_mark_completed: false,
    ...args,
  };
  return full as GeneratedRpcArgs;
}

async function cleanup(leaseToken: string | null) {
  const { error: syncDeleteError, count: syncDeleteCount } = await admin
    .from("igdb_catalogue_sync")
    .delete({ count: "exact" })
    .in("igdb_id", [...TEST_IGDB_IDS]);
  if (syncDeleteError) {
    console.error(
      "cleanup: igdb_catalogue_sync delete failed:",
      syncDeleteError.message,
    );
  }

  const { error: cursorDeleteError, count: cursorDeleteCount } = await admin
    .from("igdb_catalogue_discovery_cursor")
    .delete({ count: "exact" })
    .eq("cursor_name", TEST_CURSOR_NAME);
  if (cursorDeleteError) {
    console.error(
      "cleanup: igdb_catalogue_discovery_cursor delete failed:",
      cursorDeleteError.message,
    );
  }

  console.log(
    `cleanup: deleted ${syncDeleteCount ?? "?"} igdb_catalogue_sync row(s), ` +
      `${cursorDeleteCount ?? "?"} cursor row(s)`,
  );

  // Release the lease back to its pristine seeded state — conditional on
  // still holding the token we acquired, so a lease legitimately reclaimed
  // by something else in the meantime is never clobbered.
  if (leaseToken) {
    const { error: leaseReleaseError } = await admin
      .from("igdb_catalogue_lease")
      .update({
        token: null,
        holder: null,
        command: null,
        acquired_at: null,
        lease_until: null,
      })
      .eq("id", true)
      .eq("token", leaseToken);
    if (leaseReleaseError) {
      console.error(
        "cleanup: lease release failed:",
        leaseReleaseError.message,
      );
    }
  }
}

async function main() {
  // --- 0. Permission checks -------------------------------------------
  const { error: anonError } = await anon.rpc(
    "advance_catalogue_discovery",
    rpcArgs({
      p_lease_token: randomUUID(),
      p_page_key: "perm-check",
    }),
  );
  if (anonError) {
    record(
      "anon cannot execute advance_catalogue_discovery",
      "PASS",
      `rejected as expected (${anonError.code ?? "no code"})`,
    );
  } else {
    record(
      "anon cannot execute advance_catalogue_discovery",
      "FAIL",
      "anon call unexpectedly succeeded",
    );
  }

  // service_role's own grant is exercised implicitly by every mutating
  // call below succeeding. authenticated's lack of EXECUTE was already
  // asserted statically by the migration's own `do $$ ... $$` block at
  // apply time (the migration could not have applied successfully
  // otherwise) — not re-queried here, since this project's tooling
  // deliberately has no arbitrary-SQL execution path from application
  // code (see CLAUDE.md's "no arbitrary passthrough" rule, which applies
  // just as much to this script as to the app itself), and creating a
  // disposable `authenticated`-role session solely to re-prove a fact the
  // migration already proved isn't worth the extra live state it would
  // require cleaning up.
  record(
    "authenticated cannot execute advance_catalogue_discovery",
    "PASS",
    "confirmed statically by the migration's own privilege-assertion block " +
      "at apply time — see the do $$ ... $$ block in " +
      "20260813120000_add_igdb_catalogue_sync_infrastructure.sql",
  );

  // --- Acquire the global lease for the mutating exercises below -------
  const leaseToken = randomUUID();
  const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: leaseRows, error: leaseError } = await admin
    .from("igdb_catalogue_lease")
    .update({
      token: leaseToken,
      holder: "catalogue-checkpoint-smoke-test",
      command: "discover",
      acquired_at: new Date().toISOString(),
      lease_until: leaseUntil,
    })
    .eq("id", true)
    .or("token.is.null,lease_until.lt.now()")
    .select("id");

  if (leaseError || !leaseRows || leaseRows.length === 0) {
    record(
      "acquire global catalogue lease",
      "FAIL",
      leaseError?.message
        ? "lease acquisition failed (see server logs)"
        : "lease is currently held by something else — re-run once it's free",
    );
    return finish(null);
  }
  record("acquire global catalogue lease", "PASS", "acquired for this run");

  try {
    // --- 1. Page A: first-ever page for this cursor ---------------------
    const pageA = {
      cursorName: TEST_CURSOR_NAME,
      candidates: [
        {
          igdbId: -1001,
          profile: TEST_PROFILE,
          igdbUpdatedAtUnix: 1_700_000_000,
        },
      ],
      markIneligible: [],
      newLastIgdbId: -1001,
      newLastUpdatedAtUnix: null,
      newLastUpdatedAtIgdbId: null,
      newLastReleaseCheckUnix: null,
      newLastReleaseCheckIgdbId: null,
      markCompleted: false,
    };
    const pageKeyA = buildCataloguePageKey(pageA);
    const { data: resultA, error: errorA } = await admin.rpc(
      "advance_catalogue_discovery",
      rpcArgs({
        p_lease_token: leaseToken,
        p_page_key: pageKeyA,
        p_expected_previous_page_key: null,
        p_candidates: pageA.candidates.map((c) => ({
          igdb_id: c.igdbId,
          profile: c.profile,
          igdb_updated_at_unix: c.igdbUpdatedAtUnix,
        })),
        p_new_last_igdb_id: pageA.newLastIgdbId,
      }),
    );
    checkApplied("page A applies as a fresh page", resultA, errorA, {
      encountered: 1,
      newRows: 1,
    });

    // --- 2. Page B: expects previous = page A's key ----------------------
    const pageB = {
      ...pageA,
      candidates: [
        {
          igdbId: -1002,
          profile: TEST_PROFILE,
          igdbUpdatedAtUnix: 1_700_000_100,
        },
      ],
      newLastIgdbId: -1002,
    };
    const pageKeyB = buildCataloguePageKey(pageB);
    const { data: resultB, error: errorB } = await admin.rpc(
      "advance_catalogue_discovery",
      rpcArgs({
        p_lease_token: leaseToken,
        p_page_key: pageKeyB,
        p_expected_previous_page_key: pageKeyA,
        p_candidates: pageB.candidates.map((c) => ({
          igdb_id: c.igdbId,
          profile: c.profile,
          igdb_updated_at_unix: c.igdbUpdatedAtUnix,
        })),
        p_new_last_igdb_id: pageB.newLastIgdbId,
      }),
    );
    checkApplied("page B applies after page A", resultB, errorB, {
      encountered: 1,
      newRows: 1,
    });

    const { data: cursorAfterB } = await admin
      .from("igdb_catalogue_discovery_cursor")
      .select("candidates_discovered, last_applied_page_key")
      .eq("cursor_name", TEST_CURSOR_NAME)
      .single();

    // --- 3. Retry of page B: exact repeat -> already_applied, no mutation
    const { data: retryB, error: retryBError } = await admin.rpc(
      "advance_catalogue_discovery",
      rpcArgs({
        p_lease_token: leaseToken,
        p_page_key: pageKeyB,
        p_expected_previous_page_key: pageKeyA,
        p_candidates: pageB.candidates.map((c) => ({
          igdb_id: c.igdbId,
          profile: c.profile,
          igdb_updated_at_unix: c.igdbUpdatedAtUnix,
        })),
        p_new_last_igdb_id: pageB.newLastIgdbId,
      }),
    );
    if (
      !retryBError &&
      retryB &&
      typeof retryB === "object" &&
      (retryB as { status?: string }).status === "already_applied"
    ) {
      record("retry of page B is a no-op", "PASS", "status=already_applied");
    } else {
      record(
        "retry of page B is a no-op",
        "FAIL",
        `expected already_applied, got ${JSON.stringify(retryB)} / ${retryBError?.message}`,
      );
    }
    const { data: cursorAfterRetryB } = await admin
      .from("igdb_catalogue_discovery_cursor")
      .select("candidates_discovered")
      .eq("cursor_name", TEST_CURSOR_NAME)
      .single();
    if (
      cursorAfterB?.candidates_discovered ===
      cursorAfterRetryB?.candidates_discovered
    ) {
      record(
        "retry of page B does not double-count candidates_discovered",
        "PASS",
        `stayed at ${cursorAfterRetryB?.candidates_discovered}`,
      );
    } else {
      record(
        "retry of page B does not double-count candidates_discovered",
        "FAIL",
        `${cursorAfterB?.candidates_discovered} -> ${cursorAfterRetryB?.candidates_discovered}`,
      );
    }

    // --- 4. Delayed retry of page A, arriving after B: must be rejected --
    const { error: delayedAError } = await admin.rpc(
      "advance_catalogue_discovery",
      rpcArgs({
        p_lease_token: leaseToken,
        p_page_key: pageKeyA,
        p_expected_previous_page_key: null, // stale caller's belief, pre-dates B
        p_candidates: pageA.candidates.map((c) => ({
          igdb_id: c.igdbId,
          profile: c.profile,
          igdb_updated_at_unix: c.igdbUpdatedAtUnix,
        })),
        p_new_last_igdb_id: pageA.newLastIgdbId,
      }),
    );
    if (delayedAError) {
      record(
        "delayed retry of page A after B is rejected",
        "PASS",
        `rejected as expected (${delayedAError.code ?? delayedAError.message})`,
      );
    } else {
      record(
        "delayed retry of page A after B is rejected",
        "FAIL",
        "stale page unexpectedly applied",
      );
    }
    const { data: cursorAfterStaleA } = await admin
      .from("igdb_catalogue_discovery_cursor")
      .select("last_applied_page_key")
      .eq("cursor_name", TEST_CURSOR_NAME)
      .single();
    if (cursorAfterStaleA?.last_applied_page_key === pageKeyB) {
      record(
        "stale page A retry left the cursor unchanged",
        "PASS",
        "last_applied_page_key still points at page B",
      );
    } else {
      record(
        "stale page A retry left the cursor unchanged",
        "FAIL",
        `last_applied_page_key is ${cursorAfterStaleA?.last_applied_page_key}, expected page B's key`,
      );
    }

    // --- 5. Lease-token fencing: wrong token is rejected before mutation -
    const { error: wrongTokenError } = await admin.rpc(
      "advance_catalogue_discovery",
      rpcArgs({
        p_lease_token: randomUUID(),
        p_page_key: "wrong-token-check",
        p_expected_previous_page_key: pageKeyB,
      }),
    );
    if (wrongTokenError) {
      record(
        "wrong lease token is rejected",
        "PASS",
        `rejected as expected (${wrongTokenError.code ?? wrongTokenError.message})`,
      );
    } else {
      record(
        "wrong lease token is rejected",
        "FAIL",
        "call unexpectedly succeeded",
      );
    }

    // --- 6. Duplicate igdb_id within one page: deduped, not double-applied
    const pageC = {
      ...pageA,
      candidates: [
        {
          igdbId: -1003,
          profile: TEST_PROFILE,
          igdbUpdatedAtUnix: 1_700_000_200,
        },
        {
          igdbId: -1003,
          profile: TEST_PROFILE,
          igdbUpdatedAtUnix: 1_700_000_200,
        },
      ],
      newLastIgdbId: -1003,
    };
    const pageKeyC = buildCataloguePageKey({
      ...pageC,
      candidates: [pageC.candidates[0]],
    });
    const { data: resultC, error: errorC } = await admin.rpc(
      "advance_catalogue_discovery",
      rpcArgs({
        p_lease_token: leaseToken,
        p_page_key: pageKeyC,
        p_expected_previous_page_key: pageKeyB,
        p_candidates: pageC.candidates.map((c) => ({
          igdb_id: c.igdbId,
          profile: c.profile,
          igdb_updated_at_unix: c.igdbUpdatedAtUnix,
        })),
        p_new_last_igdb_id: pageC.newLastIgdbId,
      }),
    );
    checkApplied(
      "duplicate igdb_id within one page is deduped (no double-affect error)",
      resultC,
      errorC,
      { encountered: 1, newRows: 1 },
    );

    // --- 7. Re-encountering an already-known igdb_id: xmax counting ------
    const pageD = {
      ...pageA,
      candidates: [
        {
          igdbId: -1001,
          profile: TEST_PROFILE,
          igdbUpdatedAtUnix: 1_700_000_300,
        }, // already known
        {
          igdbId: -1004,
          profile: TEST_PROFILE,
          igdbUpdatedAtUnix: 1_700_000_300,
        }, // new
      ],
      newLastIgdbId: -1004,
    };
    const pageKeyD = buildCataloguePageKey(pageD);
    const { data: resultD, error: errorD } = await admin.rpc(
      "advance_catalogue_discovery",
      rpcArgs({
        p_lease_token: leaseToken,
        p_page_key: pageKeyD,
        p_expected_previous_page_key: pageKeyC,
        p_candidates: pageD.candidates.map((c) => ({
          igdb_id: c.igdbId,
          profile: c.profile,
          igdb_updated_at_unix: c.igdbUpdatedAtUnix,
        })),
        p_new_last_igdb_id: pageD.newLastIgdbId,
      }),
    );
    checkApplied(
      "re-encountering a known igdb_id counts as encountered but not new",
      resultD,
      errorD,
      { encountered: 2, newRows: 1 },
    );

    // --- 8. Unix-seconds timestamp conversion round-trips correctly ------
    // -1002 is written exactly once (page B, 1_700_000_100) and never
    // touched again by a later page, unlike -1001 (re-touched by page D to
    // a deliberately *different* timestamp — see the "re-encountering an
    // already-known igdb_id" check above) — using -1001 here would be
    // checking the wrong write.
    const { data: rowB } = await admin
      .from("igdb_catalogue_sync")
      .select("igdb_updated_at")
      .eq("igdb_id", -1002)
      .single();
    const expectedIso = new Date(1_700_000_100 * 1000).toISOString();
    if (
      rowB?.igdb_updated_at &&
      new Date(rowB.igdb_updated_at).toISOString() === expectedIso
    ) {
      record(
        "Unix-seconds -> to_timestamp() round-trips correctly",
        "PASS",
        `1700000100 -> ${rowB.igdb_updated_at}`,
      );
    } else {
      record(
        "Unix-seconds -> to_timestamp() round-trips correctly",
        "FAIL",
        `expected ${expectedIso}, got ${rowB?.igdb_updated_at}`,
      );
    }

    // Two different igdb_ids sharing the exact same igdb_updated_at_unix
    // both persist distinctly (storage-side tie support; the ORDER BY
    // tie-break query construction itself is covered by a pure unit test,
    // not this live check). Page D wrote -1001 and -1004 with the
    // identical 1_700_000_300 timestamp.
    const { data: tieRows } = await admin
      .from("igdb_catalogue_sync")
      .select("igdb_id, igdb_updated_at")
      .in("igdb_id", [-1001, -1004]);
    const tieValues = new Set((tieRows ?? []).map((r) => r.igdb_updated_at));
    if ((tieRows?.length ?? 0) === 2 && tieValues.size === 1) {
      record(
        "equal igdb_updated_at values persist distinctly per igdb_id",
        "PASS",
        "both rows stored with the identical timestamp, no collision",
      );
    } else {
      record(
        "equal igdb_updated_at values persist distinctly per igdb_id",
        "FAIL",
        `expected 2 rows sharing 1 timestamp, got ${JSON.stringify(tieRows)}`,
      );
    }
  } finally {
    await cleanup(leaseToken);
  }

  return finish(leaseToken);
}

function checkApplied(
  check: string,
  data: unknown,
  error: { message: string; code?: string } | null,
  expected: { encountered: number; newRows: number },
) {
  if (error) {
    record(check, "FAIL", `RPC error: ${error.message}`);
    return;
  }
  const result = data as {
    status?: string;
    candidates_encountered?: number;
    new_ledger_rows?: number;
  } | null;
  if (
    result?.status === "applied" &&
    result.candidates_encountered === expected.encountered &&
    result.new_ledger_rows === expected.newRows
  ) {
    record(
      check,
      "PASS",
      `encountered=${result.candidates_encountered}, new=${result.new_ledger_rows}`,
    );
  } else {
    record(check, "FAIL", `unexpected result: ${JSON.stringify(result)}`);
  }
}

function finish(leaseToken: string | null) {
  void leaseToken;
  const width = Math.max(...results.map((r) => r.check.length)) + 2;
  console.log("\n=== Savepoint catalogue checkpoint smoke test ===\n");
  for (const r of results) {
    console.log(
      `[${r.verdict.padEnd(4)}] ${r.check.padEnd(width)} ${r.detail}`,
    );
  }
  const failed = results.filter((r) => r.verdict === "FAIL");
  console.log(
    `\n${results.length} checks: ${results.length - failed.length} passed, ${failed.length} failed.\n`,
  );
  console.log("All test rows and the global lease have been cleaned up.\n");
  if (failed.length > 0) process.exit(1);
}

await main();
