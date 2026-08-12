// Gate B: read-only IGDB catalogue estimator (Prompt 7C). Never mutates
// anything — no Supabase write, no Pinecone write, no IGDB write. Promotes
// the bounded manual count/sample queries run during planning into a real,
// documented, re-runnable tool. Run manually with:
//   npm run igdb:catalogue-estimate
//
// Safety design, mirroring scripts/igdb-smoke-test.mts's conventions:
//   - .env.local loaded via process.loadEnvFile with a graceful fallback.
//   - Never prints IGDB_CLIENT_ID/IGDB_CLIENT_SECRET/PINECONE_API_KEY.
//   - Only ever calls IGDB's read-only `games`/`games/count`/`game_types`
//     endpoints and Pinecone's read-only describeIndex/describeIndexStats —
//     no upsert, no delete, no index creation.
//
// Why this reimplements the IGDB token/request glue inline rather than
// importing src/lib/igdb/{token,client}.ts: those (correctly) start with
// `import "server-only"`, which throws unconditionally outside Next's own
// bundler. This script reuses the real, pure, non-`server-only` profile
// logic from catalogue-profile.ts directly, matching every other script in
// this directory's established precedent (see apicalypse.ts's header
// comment).

import {
  CATALOGUE_PROFILES,
  buildCatalogueWhereClause,
  type CatalogueProfileName,
  type GameTypeRef,
} from "../src/lib/igdb/catalogue-profile.ts";
import { buildCatalogueCountQuery } from "../src/lib/igdb/apicalypse.ts";
import {
  PINECONE_NAMESPACE,
  EMBEDDING_TOKEN_SAFETY_MULTIPLIER,
} from "../src/lib/pinecone/constants.ts";
import { Pinecone } from "@pinecone-database/pinecone";

// Confirmed live against docs.pinecone.io/reference/api/database-limits and
// pinecone.io/pricing on 2026-08-12 for the Starter (free) plan — not an
// API this project can introspect programmatically, so these are
// documented constants, re-verify manually if pricing changes.
const STARTER_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
const STARTER_WRITE_UNITS_PER_MONTH = 2_000_000;
const STARTER_READ_UNITS_PER_MONTH = 1_000_000;
const STARTER_EMBED_TOKENS_PER_MONTH = 5_000_000;
const STARTER_EMBED_TOKENS_PER_MINUTE = 250_000;

const BYTES_PER_RECORD_ESTIMATE = 4_500; // ~4KB (1024-dim vector) + ~0.5KB metadata

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const igdbClientId = process.env.IGDB_CLIENT_ID;
const igdbClientSecret = process.env.IGDB_CLIENT_SECRET;
const pineconeApiKey = process.env.PINECONE_API_KEY;
const pineconeIndexName = process.env.PINECONE_INDEX_NAME || "savepoint-games";

if (!igdbClientId || !igdbClientSecret) {
  console.error(
    "IGDB_CLIENT_ID / IGDB_CLIENT_SECRET: one or more MISSING. Cannot run without them (values never printed).",
  );
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: igdbClientId!,
    client_secret: igdbClientSecret!,
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?${params.toString()}`,
    {
      method: "POST",
    },
  );
  if (!res.ok)
    throw new Error(`Twitch token request failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token)
    throw new Error("Twitch token response had no access_token");
  return data.access_token;
}

async function igdbRequest<T>(
  token: string,
  endpoint: string,
  body: string,
): Promise<T[]> {
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": igdbClientId!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `${endpoint} request failed: HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T[]>;
}

async function igdbCount(token: string, whereClause: string): Promise<number> {
  const res = await fetch(`https://api.igdb.com/v4/games/count`, {
    method: "POST",
    headers: {
      "Client-ID": igdbClientId!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: buildCatalogueCountQuery(whereClause),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `count request failed: HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { count: number };
  return data.count;
}

interface SampleGame {
  name: string;
  summary?: string | null;
  storyline?: string | null;
  genres?: { name: string }[];
  platforms?: { name: string }[];
  game_modes?: { name: string }[];
  themes?: { name: string }[];
  keywords?: { name: string }[];
}

function estimateEmbeddingChars(game: SampleGame): number {
  const parts = [game.name];
  const description = game.summary ?? game.storyline;
  if (description) parts.push(description);
  if (game.genres?.length)
    parts.push(`Genres: ${game.genres.map((g) => g.name).join(", ")}.`);
  if (game.platforms?.length)
    parts.push(`Platforms: ${game.platforms.map((p) => p.name).join(", ")}.`);
  if (game.game_modes?.length)
    parts.push(`Modes: ${game.game_modes.map((m) => m.name).join(", ")}.`);
  if (game.themes?.length)
    parts.push(`Themes: ${game.themes.map((t) => t.name).join(", ")}.`);
  if (game.keywords?.length)
    parts.push(
      `Keywords: ${game.keywords
        .slice(0, 10)
        .map((k) => k.name)
        .join(", ")}.`,
    );
  return parts.join(" ").length;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024).toFixed(0)}KB`;
}

async function estimateProfile(
  token: string,
  profile: CatalogueProfileName,
  gameTypes: GameTypeRef[],
  now: number,
): Promise<void> {
  console.log(
    `\n--- Profile: ${profile} (${CATALOGUE_PROFILES[profile].mode} ${CATALOGUE_PROFILES[profile].typeNames.join("/")}) ---`,
  );

  const whereClause = buildCatalogueWhereClause({
    profile,
    gameTypes,
    nowUnixSeconds: now,
  });
  await sleep(300);
  const count = await igdbCount(token, whereClause);
  console.log(`Candidate count: ${count.toLocaleString()}`);

  await sleep(300);
  const sample = await igdbRequest<SampleGame>(
    token,
    "games",
    [
      "fields name,summary,storyline,genres.name,platforms.name,game_modes.name,themes.name,keywords.name;",
      `where ${whereClause};`,
      "sort total_rating_count desc;",
      "limit 25;",
    ].join("\n"),
  );

  const charCounts = sample.map(estimateEmbeddingChars);
  const avgChars = charCounts.length
    ? charCounts.reduce((a, b) => a + b, 0) / charCounts.length
    : 0;
  const maxChars = charCounts.length ? Math.max(...charCounts) : 0;
  const avgTokens = avgChars / 4;
  const rawTotalTokens = count * avgTokens;
  const marginedTotalTokens =
    rawTotalTokens * EMBEDDING_TOKEN_SAFETY_MULTIPLIER;
  const storageBytes = count * BYTES_PER_RECORD_ESTIMATE;
  const detailRequests = Math.ceil(count / 200);
  const discoveryRequests = Math.ceil(count / 500);

  console.log(
    `Sample text length: avg ${avgChars.toFixed(0)} chars (~${avgTokens.toFixed(0)} tokens), max ${maxChars} chars — 25-record sample, ±30% uncertainty`,
  );
  console.log(
    `Estimated one-time embedding cost: ~${Math.round(rawTotalTokens).toLocaleString()} raw tokens / ` +
      `~${Math.round(marginedTotalTokens).toLocaleString()} with ${EMBEDDING_TOKEN_SAFETY_MULTIPLIER}x safety margin ` +
      `(${((marginedTotalTokens / STARTER_EMBED_TOKENS_PER_MONTH) * 100).toFixed(0)}% of the ${STARTER_EMBED_TOKENS_PER_MONTH.toLocaleString()}/month Starter budget)`,
  );
  console.log(
    `Estimated storage: ~${formatBytes(storageBytes)} (${((storageBytes / STARTER_STORAGE_BYTES) * 100).toFixed(1)}% of the ${formatBytes(STARTER_STORAGE_BYTES)} Starter budget)`,
  );
  console.log(
    `Estimated IGDB requests: ~${discoveryRequests} discovery pages (500/page) + ~${detailRequests} detail batches (200/batch)`,
  );
  if (marginedTotalTokens > STARTER_EMBED_TOKENS_PER_MONTH) {
    console.log(
      `⚠ A single-pass initial sync would exceed the monthly embedding budget — split across ≥${Math.ceil(marginedTotalTokens / STARTER_EMBED_TOKENS_PER_MONTH) + 1} monthly windows.`,
    );
  }
}

async function main() {
  console.log(
    "\n=== Savepoint IGDB catalogue estimator (Gate B, read-only) ===\n",
  );

  const token = await getToken();
  console.log("PASS: obtained Twitch token (not printed)");

  await sleep(300);
  const gameTypes = await igdbRequest<GameTypeRef>(
    token,
    "game_types",
    "fields id,type; limit 50;",
  );
  console.log(
    `Resolved ${gameTypes.length} game_types live: ${gameTypes.map((t) => `${t.type}=${t.id}`).join(", ")}`,
  );

  const now = Math.floor(Date.now() / 1000);
  const requestedProfile = process.argv
    .slice(2)
    .find((a) => a.startsWith("--profile="))
    ?.split("=")[1] as CatalogueProfileName | undefined;
  const profiles: CatalogueProfileName[] = requestedProfile
    ? [requestedProfile]
    : ["conservative", "balanced", "broad"];

  for (const profile of profiles) {
    await estimateProfile(token, profile, gameTypes, now);
  }

  // Read-only Pinecone quota cross-check, if credentials are present.
  if (pineconeApiKey) {
    try {
      const pc = new Pinecone({ apiKey: pineconeApiKey });
      const indexModel = await pc.describeIndex(pineconeIndexName);
      const index = pc
        .index(pineconeIndexName, indexModel.host)
        .namespace(PINECONE_NAMESPACE);
      const stats = await index.describeIndexStats();
      const currentRecords =
        stats.namespaces?.[PINECONE_NAMESPACE]?.recordCount ?? 0;
      console.log(`\n--- Live Pinecone state ---`);
      console.log(
        `Index: ${pineconeIndexName}, namespace: ${PINECONE_NAMESPACE}, current records: ${currentRecords}`,
      );
      console.log(
        `Documented Starter limits (not programmatically queryable — confirmed live against docs.pinecone.io on 2026-08-12):`,
      );
      console.log(
        `  Storage: ${formatBytes(STARTER_STORAGE_BYTES)}/mo | Write Units: ${STARTER_WRITE_UNITS_PER_MONTH.toLocaleString()}/mo | ` +
          `Read Units: ${STARTER_READ_UNITS_PER_MONTH.toLocaleString()}/mo`,
      );
      console.log(
        `  Embedding tokens: ${STARTER_EMBED_TOKENS_PER_MONTH.toLocaleString()}/mo, ${STARTER_EMBED_TOKENS_PER_MINUTE.toLocaleString()}/min (passage) — project-wide, shared with ordinary Savepoint traffic`,
      );
    } catch (err) {
      console.log(
        `\n(Pinecone quota cross-check skipped: ${err instanceof Error ? err.message : "unknown error"})`,
      );
    }
  }

  console.log(
    "\nThis command performed no mutation of any kind — no Supabase write, no Pinecone write, no IGDB write.\n",
  );
}

await main();
