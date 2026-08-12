// Read-only Phase B verification tool — runs the three example semantic
// queries from the spec against the real configured index and confirms the
// returned ids resolve to real Supabase games. Run with:
//   npm run pinecone:smoke-test
//
// Never creates, deletes, mutates, or upserts anything. Never prints
// credentials or a raw error body — only PASS/FAIL-style output and
// sanitized diagnostics, mirroring scripts/igdb-smoke-test.mts's
// conventions.

import { Pinecone, Errors } from "@pinecone-database/pinecone";
import { createClient } from "@supabase/supabase-js";
import { PINECONE_NAMESPACE } from "../src/lib/pinecone/constants.ts";
import {
  isIndexCompatible,
  describeIncompatibility,
} from "../src/lib/pinecone/index-compat.ts";
import { sanitizeErrorForStorage } from "../src/lib/pinecone/error-sanitizer.ts";
import type { Database } from "../src/types/database.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const pineconeApiKey = process.env.PINECONE_API_KEY;
const indexName = process.env.PINECONE_INDEX_NAME || "savepoint-games";

if (!supabaseUrl || !supabaseSecretKey || !pineconeApiKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / PINECONE_API_KEY: " +
      "one or more MISSING. Cannot run without them (values never printed).",
  );
  process.exit(1);
}

const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pc = new Pinecone({ apiKey: pineconeApiKey });

const EXAMPLE_QUERIES = [
  "atmospheric science-fiction exploration",
  "cosy farming game with relationships",
  "difficult tactical RPG with meaningful choices",
];

const TOP_K = 5;

async function main() {
  console.log("\n=== Savepoint Pinecone smoke test ===\n");

  let indexModel;
  try {
    indexModel = await pc.describeIndex(indexName);
  } catch (err) {
    if (err instanceof Errors.PineconeNotFoundError) {
      console.error(
        `Pinecone index "${indexName}" does not exist. Run \`npm run pinecone:bootstrap\` first.`,
      );
      process.exit(1);
    }
    throw err;
  }
  if (!isIndexCompatible(indexModel)) {
    console.error(
      `Pinecone index "${indexName}" is incompatible: ${describeIncompatibility(indexModel)}`,
    );
    process.exit(1);
  }

  const namespace = pc.index({
    host: indexModel.host,
    namespace: PINECONE_NAMESPACE,
  });

  let totalHits = 0;
  let failures = 0;

  for (const query of EXAMPLE_QUERIES) {
    console.log(`Query: "${query}"`);
    try {
      const response = await namespace.searchRecords({
        query: { inputs: { text: query }, topK: TOP_K },
        fields: ["game_id"],
      });

      const gameIds = response.result.hits
        .map((hit) => (hit.fields as Record<string, unknown>).game_id)
        .filter((id): id is string => typeof id === "string");

      if (gameIds.length === 0) {
        console.log("  (no hits)\n");
        continue;
      }

      const { data: rows } = await admin
        .from("games")
        .select("id, slug, name")
        .in("id", gameIds);
      const byId = new Map((rows ?? []).map((row) => [row.id, row]));

      for (const hit of response.result.hits) {
        const gameId = (hit.fields as Record<string, unknown>).game_id;
        const row = typeof gameId === "string" ? byId.get(gameId) : undefined;
        totalHits += 1;
        if (row) {
          console.log(
            `  [${hit._score.toFixed(4)}] ${row.name} (${row.slug}, id ${row.id})`,
          );
        } else {
          console.log(
            `  [${hit._score.toFixed(4)}] id ${String(gameId)} — no matching Supabase row (stale index entry)`,
          );
        }
      }
      console.log("");
    } catch (err) {
      failures += 1;
      console.log(`  FAILED: ${sanitizeErrorForStorage(err)}\n`);
    }
  }

  console.log(
    `Summary: ${EXAMPLE_QUERIES.length} quer${EXAMPLE_QUERIES.length === 1 ? "y" : "ies"}, ${totalHits} hit(s) total, ${failures} failure(s).`,
  );
  console.log(`\nIndex:     ${indexName}`);
  console.log(`Namespace: ${PINECONE_NAMESPACE}`);

  if (failures > 0) process.exit(1);
}

await main();
