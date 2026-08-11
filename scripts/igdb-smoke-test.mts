// Opt-in, live, real-network smoke test for the IGDB integration. NOT part
// of `npm test` — this hits the real Twitch/IGDB APIs and writes one real
// row into the live Supabase project via the secret key. Run manually with:
//   npm run igdb:smoke-test
//
// Safety design, mirroring scripts/verify-schema.mts's conventions:
//   - .env.local loaded via process.loadEnvFile with a graceful fallback to
//     the ambient environment (same pattern, not duplicated logic).
//   - Never prints a token, secret key, or client secret value — only
//     PASS/FAIL classifications and short, truncated diagnostic text.
//   - The one write this script performs is a real game import — reported
//     explicitly at the end (name/igdb_id/slug) along with the exact
//     cleanup SQL to remove it. The script never auto-deletes; cleanup is
//     the operator's call.
//
// Why this doesn't import src/lib/igdb/{token,client,search,detail}.ts or
// src/server/services/game-sync.ts directly: those (correctly) start with
// `import "server-only"`, which throws unconditionally outside Next's own
// bundler (see vitest.setup.ts's comment on the same issue, and
// verify-schema.mts's own precedent of not importing src/lib/supabase/*
// either). This script instead reuses the real, pure, non-`server-only`
// logic (query building, mapping, ranking) from apicalypse.ts/mappers.ts/
// ranking.ts/normalize.ts directly, and re-implements only the thin
// secret-touching glue (the Twitch token fetch, the raw IGDB fetch, the
// admin Supabase client, and the same upsert/onConflict strategy
// game-sync.ts's upsertGameFromIgdbDetail uses) inline, at script scope.

import { createClient } from "@supabase/supabase-js";
import {
  buildDetailQuery,
  buildSearchQuery,
} from "../src/lib/igdb/apicalypse.ts";
import {
  mapIgdbGameToRow,
  mapIgdbSearchResult,
} from "../src/lib/igdb/mappers.ts";
import {
  excludeUnwantedGameTypes,
  rankSearchResults,
} from "../src/lib/igdb/ranking.ts";
import type {
  IgdbGameDetailRaw,
  IgdbGameSearchRaw,
} from "../src/lib/igdb/types.ts";
import type { Database } from "../src/types/database.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const igdbClientId = process.env.IGDB_CLIENT_ID;
const igdbClientSecret = process.env.IGDB_CLIENT_SECRET;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!igdbClientId || !igdbClientSecret || !supabaseUrl || !supabaseSecretKey) {
  console.error(
    "IGDB_CLIENT_ID / IGDB_CLIENT_SECRET / NEXT_PUBLIC_SUPABASE_URL / " +
      "SUPABASE_SECRET_KEY: one or more MISSING. Cannot run the live smoke " +
      "test without them (values are never printed).",
  );
  process.exit(1);
}

const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
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

function truncate(message: string | undefined, max = 140): string {
  if (!message) return "(no message)";
  return message.length > max ? `${message.slice(0, max)}…` : message;
}

const SAMPLE_TITLE = "The Legend of Zelda: Breath of the Wild";

async function getTwitchToken(): Promise<string | null> {
  const params = new URLSearchParams({
    client_id: igdbClientId!,
    client_secret: igdbClientSecret!,
    grant_type: "client_credentials",
  });
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?${params.toString()}`,
    { method: "POST" },
  );
  if (!response.ok) {
    record("Twitch token", "FAIL", `HTTP ${response.status}`);
    return null;
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    record("Twitch token", "FAIL", "response had no access_token");
    return null;
  }
  record("Twitch token", "PASS", "obtained (value not printed)");
  return data.access_token;
}

async function igdbFetch<T>(
  token: string,
  endpoint: string,
  body: string,
): Promise<T[] | null> {
  const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": igdbClientId!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!response.ok) {
    record(`IGDB ${endpoint} request`, "FAIL", `HTTP ${response.status}`);
    return null;
  }
  return (await response.json()) as T[];
}

async function main() {
  const token = await getTwitchToken();
  if (!token) return finish();

  const searchRaw = await igdbFetch<IgdbGameSearchRaw>(
    token,
    "games",
    buildSearchQuery(SAMPLE_TITLE, 10),
  );
  if (!searchRaw) return finish();

  const ranked = rankSearchResults(
    SAMPLE_TITLE,
    excludeUnwantedGameTypes(searchRaw.map(mapIgdbSearchResult)),
  );
  const top = ranked[0];
  if (top && top.name.toLowerCase().includes("breath of the wild")) {
    record(
      "IGDB search + ranking",
      "PASS",
      `top result: "${truncate(top.name, 60)}"`,
    );
  } else {
    record(
      "IGDB search + ranking",
      "FAIL",
      `expected the canonical title near the top, got "${truncate(top?.name, 60)}"`,
    );
  }

  const targetIgdbId = top?.igdbId;
  if (!targetIgdbId) return finish();

  const detailRaw = await igdbFetch<IgdbGameDetailRaw>(
    token,
    "games",
    buildDetailQuery(targetIgdbId),
  );
  const rawDetail = detailRaw?.[0];
  if (!rawDetail) {
    record("IGDB detail fetch", "FAIL", "no detail row returned");
    return finish();
  }
  record("IGDB detail fetch", "PASS", `fetched igdb_id ${targetIgdbId}`);

  const detail = mapIgdbGameToRow(rawDetail);

  async function importDetail() {
    if (detail.genres.length > 0) {
      await admin.from("genres").upsert(detail.genres, { onConflict: "id" });
    }
    if (detail.platforms.length > 0) {
      await admin
        .from("platforms")
        .upsert(detail.platforms, { onConflict: "id" });
    }
    if (detail.gameModes.length > 0) {
      await admin
        .from("game_modes")
        .upsert(detail.gameModes, { onConflict: "id" });
    }
    if (detail.themes.length > 0) {
      await admin.from("themes").upsert(detail.themes, { onConflict: "id" });
    }
    const { data: game, error } = await admin
      .from("games")
      .upsert(detail.game, { onConflict: "igdb_id" })
      .select()
      .single();
    if (error || !game) throw error ?? new Error("no game row returned");

    await admin.from("game_genres").delete().eq("game_id", game.id);
    if (detail.genres.length > 0) {
      await admin
        .from("game_genres")
        .insert(
          detail.genres.map((g) => ({ game_id: game.id, genre_id: g.id })),
        );
    }
    await admin
      .from("game_vector_sync")
      .upsert(
        { game_id: game.id, status: "pending" },
        { onConflict: "game_id" },
      );

    return game;
  }

  let imported;
  try {
    imported = await importDetail();
    record(
      "Import into Supabase",
      "PASS",
      `games row present for igdb_id ${targetIgdbId}`,
    );
  } catch (error) {
    record(
      "Import into Supabase",
      "FAIL",
      truncate(error instanceof Error ? error.message : String(error)),
    );
    return finish();
  }

  try {
    await importDetail();
  } catch (error) {
    record(
      "Re-import (idempotency)",
      "FAIL",
      truncate(error instanceof Error ? error.message : String(error)),
    );
    return finish(imported);
  }

  const { count: gameRowCount } = await admin
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("igdb_id", targetIgdbId);
  const { count: joinRowCount } = await admin
    .from("game_genres")
    .select("game_id", { count: "exact", head: true })
    .eq("game_id", imported.id);

  if (gameRowCount === 1) {
    record(
      "Re-import (idempotency)",
      "PASS",
      `exactly 1 games row for igdb_id ${targetIgdbId} after importing twice`,
    );
  } else {
    record(
      "Re-import (idempotency)",
      "FAIL",
      `expected 1 games row, found ${gameRowCount ?? "unknown"}`,
    );
  }
  record(
    "Re-import join-table dedupe",
    (joinRowCount ?? 0) === detail.genres.length ? "PASS" : "FAIL",
    `${joinRowCount ?? "unknown"} game_genres row(s) after importing twice`,
  );

  return finish(imported);
}

function finish(imported?: {
  id: string;
  igdb_id: number;
  slug: string;
  name: string;
}) {
  const width = Math.max(...results.map((r) => r.check.length)) + 2;
  console.log("\n=== Savepoint IGDB smoke test ===\n");
  for (const r of results) {
    console.log(
      `[${r.verdict.padEnd(4)}] ${r.check.padEnd(width)} ${r.detail}`,
    );
  }
  const failed = results.filter((r) => r.verdict === "FAIL");
  console.log(
    `\n${results.length} checks: ${results.length - failed.length} passed, ${failed.length} failed.\n`,
  );

  if (imported) {
    console.log("--- Imported test data (not auto-deleted) ---");
    console.log(`  name:    ${imported.name}`);
    console.log(`  igdb_id: ${imported.igdb_id}`);
    console.log(`  slug:    ${imported.slug}`);
    console.log(`  uuid:    ${imported.id}`);
    console.log(
      "\nTo remove it (cascades to every join table + game_vector_sync):",
    );
    console.log(`  delete from games where igdb_id = ${imported.igdb_id};\n`);
  }

  if (failed.length > 0) process.exit(1);
}

await main();
