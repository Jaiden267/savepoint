// Administrative, manual-only script — the ONLY code path in this repo
// permitted to call createIndexForModel. Application runtime code
// (src/lib/pinecone/client.ts) only ever describes/validates the
// configured index; it has no import path to this script or to
// index-creation logic. Run manually with:
//   npm run pinecone:bootstrap
//
// Read-only preflight (fully loads modules, validates env, authenticates,
// lists/describes indexes — never creates/deletes/configures/upserts
// anything, regardless of what it finds):
//   npm run pinecone:bootstrap -- --check
//   npm run pinecone:bootstrap -- --dry-run   (alias)
//
// Safety design, mirroring scripts/igdb-smoke-test.mts's conventions:
//   - .env.local loaded via process.loadEnvFile with a graceful fallback to
//     the ambient environment.
//   - Never prints PINECONE_API_KEY.
//   - Describes first. Creates only if genuinely missing, and only outside
//     --check/--dry-run. If an index with this name already exists but is
//     incompatible (wrong embedding model or text field mapping), reports
//     the conflict and stops — never deletes or recreates it.
//   - The created index has deletionProtection: "enabled" (a real,
//     validated field on the installed SDK's CreateIndexForModelOptions) as
//     an extra guard against accidental deletion, on top of the fact that
//     nothing in this codebase ever calls deleteIndex.
//
// Why this reimplements a Pinecone client here rather than importing
// src/lib/pinecone/client.ts: that module is `server-only`, whose package
// body is an unconditional throw outside Next's bundler — a plain-Node
// script can't import it. This script imports only the pure constants/
// compatibility-check helpers, matching igdb-smoke-test.mts's precedent of
// reimplementing the thin secret-touching glue inline.
//
// Module resolution note: Node's native TypeScript support (this project's
// Node 24 engine, matching the other scripts/*.mts files) resolves ESM
// imports strictly — unlike webpack/Vite, it does not infer a missing file
// extension. Every relative import this script touches (directly or
// transitively, e.g. src/lib/pinecone/index-compat.ts importing its own
// sibling constants.ts) must carry an explicit `.ts` extension, which
// tsconfig.json's `allowImportingTsExtensions` already permits project-wide
// for exactly this reason.

import { Pinecone, Errors } from "@pinecone-database/pinecone";
import {
  PINECONE_NAMESPACE,
  EMBED_MODEL,
  TEXT_FIELD,
} from "../src/lib/pinecone/constants.ts";
import {
  isIndexCompatible,
  describeIncompatibility,
} from "../src/lib/pinecone/index-compat.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check") || argv.includes("--dry-run");

const apiKey = process.env.PINECONE_API_KEY;
const indexName = process.env.PINECONE_INDEX_NAME || "savepoint-games";

console.log(
  checkOnly
    ? "\n=== Savepoint Pinecone bootstrap — READ-ONLY CHECK (--check) ===\n"
    : "\n=== Savepoint Pinecone bootstrap ===\n",
);
console.log(`PINECONE_API_KEY:    ${apiKey ? "SET" : "MISSING"}`);
console.log(`PINECONE_INDEX_NAME: ${indexName}`);
console.log(`Namespace:           ${PINECONE_NAMESPACE}`);
console.log(`Model:               ${EMBED_MODEL}\n`);

if (!apiKey) {
  console.error(
    "PINECONE_API_KEY is MISSING. Cannot authenticate without it (value never printed).",
  );
  process.exit(1);
}

const pc = new Pinecone({ apiKey });

async function main() {
  // Read-only: authenticates and lists every index in the project. Never
  // skipped, even outside --check — it's how an operator sees what already
  // exists before this script decides whether to create anything.
  let indexNames: string[] = [];
  try {
    const list = await pc.listIndexes();
    indexNames = (list.indexes ?? []).map((idx) => idx.name);
    console.log(
      indexNames.length > 0
        ? `Indexes in this project (${indexNames.length}): ${indexNames.join(", ")}`
        : "Indexes in this project: (none)",
    );
  } catch (err) {
    console.error(
      `Failed to authenticate / list indexes: ${err instanceof Error ? err.name : "unknown error"}`,
    );
    process.exit(1);
  }

  let existing;
  try {
    existing = await pc.describeIndex(indexName);
  } catch (err) {
    if (err instanceof Errors.PineconeNotFoundError) {
      existing = null;
    } else {
      console.error(
        `Unexpected error describing "${indexName}": ${err instanceof Error ? err.name : "unknown error"}`,
      );
      process.exit(1);
    }
  }

  if (existing) {
    if (isIndexCompatible(existing)) {
      console.log(
        `\nIndex "${indexName}" already exists and is compatible. Nothing to do.`,
      );
      console.log(`  host: ${existing.host}`);
      console.log(
        `  deletionProtection: ${existing.deletionProtection ?? "unknown"}`,
      );
      return;
    }
    console.error(
      `\nAn index named "${indexName}" already exists but is INCOMPATIBLE:`,
    );
    console.error(`  ${describeIncompatibility(existing)}`);
    console.error("Refusing to delete or recreate it. Resolve manually.");
    process.exit(1);
  }

  if (checkOnly) {
    console.log(
      `\nIndex "${indexName}" does not exist yet. --check/--dry-run: would ` +
        "create one serverless dense index with integrated embedding " +
        `(cloud: aws, region: us-east-1, model: ${EMBED_MODEL}, ` +
        `fieldMap.text: "${TEXT_FIELD}", deletionProtection: enabled). ` +
        "No changes made.",
    );
    return;
  }

  console.log(
    `\nIndex "${indexName}" does not exist. Creating one serverless dense index with integrated embedding...`,
  );
  const created = await pc.createIndexForModel({
    name: indexName,
    cloud: "aws",
    region: "us-east-1",
    embed: {
      model: EMBED_MODEL,
      fieldMap: { text: TEXT_FIELD },
    },
    waitUntilReady: true,
    suppressConflicts: true,
    deletionProtection: "enabled",
  });

  console.log("Index created and ready.");
  if (created) {
    console.log(`  host: ${created.host}`);
    console.log(
      `  deletionProtection: ${created.deletionProtection ?? "unknown"}`,
    );
  }
  console.log(
    "\nNext: run `npm run pinecone:backfill -- --limit 5` to sync a small " +
      "batch, then `npm run pinecone:smoke-test` to verify.\n",
  );
}

await main();

if (checkOnly) {
  console.log(
    "\n--check/--dry-run complete. No index was created, deleted, configured, or upserted to.\n",
  );
}
