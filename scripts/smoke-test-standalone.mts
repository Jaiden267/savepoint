// Opt-in verification that the standalone build actually serves pages and
// static assets. Boots `.next/standalone/server.js` as a child process,
// polls it until ready, and checks three things: the root page, one real
// `/_next/static/...` asset (extracted from the root page's own HTML — no
// hardcoded build hash, so this keeps working across rebuilds), and
// `/favicon.ico` (proves the public/ copy worked). Never touches auth,
// Supabase, or any authenticated route — this proves the server serves
// pages and static assets, nothing about signed-in flows. Not wired into
// `npm run build` — it binds a real port and shouldn't slow down or
// destabilize every build (same reasoning as verify-schema/igdb:smoke-test
// staying separate, opt-in scripts).
//
// Run with: npm run verify-standalone (requires a prior `npm run build`)

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const serverEntry = path.join(projectRoot, ".next", "standalone", "server.js");

const PORT = process.env.SMOKE_TEST_PORT ?? "3100";
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_INTERVAL_MS = 500;

class SmokeTestFailure extends Error {}

function fail(message: string): never {
  throw new SmokeTestFailure(message);
}

async function waitUntilReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(
        `standalone server exited early (code ${child.exitCode}) before it became ready`,
      );
    }
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok) return;
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  fail(
    `standalone server never responded on ${BASE_URL} within ${READY_TIMEOUT_MS}ms`,
  );
}

function extractFirstStaticAssetPath(html: string): string | null {
  const match = html.match(/\/_next\/static\/[^"'\s)]+/);
  return match ? match[0] : null;
}

async function main(): Promise<void> {
  if (!existsSync(serverEntry)) {
    fail(
      `${path.relative(projectRoot, serverEntry)} not found — run "npm run build" first.`,
    );
  }

  console.log(`Starting standalone server on ${BASE_URL} ...`);
  const child = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: { ...process.env, PORT, HOSTNAME: HOST },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  child.stdout?.on(
    "data",
    (chunk: Buffer) => (serverOutput += chunk.toString()),
  );
  child.stderr?.on(
    "data",
    (chunk: Buffer) => (serverOutput += chunk.toString()),
  );

  try {
    await waitUntilReady(child);

    const rootResponse = await fetch(`${BASE_URL}/`);
    if (!rootResponse.ok) fail(`GET / returned ${rootResponse.status}`);
    const html = await rootResponse.text();
    console.log(`PASS: GET / -> ${rootResponse.status}`);

    const assetPath = extractFirstStaticAssetPath(html);
    if (!assetPath) {
      fail(
        "could not find a /_next/static/... asset reference in the root page's HTML",
      );
    }
    const assetResponse = await fetch(BASE_URL + assetPath);
    if (!assetResponse.ok) {
      fail(`GET ${assetPath} returned ${assetResponse.status}`);
    }
    console.log(`PASS: GET ${assetPath} -> ${assetResponse.status}`);

    const faviconResponse = await fetch(`${BASE_URL}/favicon.ico`);
    if (!faviconResponse.ok) {
      fail(`GET /favicon.ico returned ${faviconResponse.status}`);
    }
    console.log(`PASS: GET /favicon.ico -> ${faviconResponse.status}`);

    // Regression check: /games/[slug] previously crashed at request time
    // ("Attempted to call starGlyphs() from the server but starGlyphs is
    // on the client") once a game had an owner-visible review. This
    // signed-out request can't reach that exact branch (it requires an
    // authenticated owner — not safely automatable here without real
    // credentials), but it does exercise the same page's real RSC
    // compilation end-to-end in the actual standalone server, which no
    // Vitest test can do.
    const gameResponse = await fetch(
      `${BASE_URL}/games/the-legend-of-zelda-breath-of-the-wild`,
    );
    if (!gameResponse.ok) {
      fail(
        `GET /games/the-legend-of-zelda-breath-of-the-wild returned ${gameResponse.status}`,
      );
    }
    console.log(
      `PASS: GET /games/the-legend-of-zelda-breath-of-the-wild -> ${gameResponse.status}`,
    );

    // Regression check: /diary previously redirected an already-onboarded
    // user all the way to their public profile via a stale-proxy-state
    // double redirect. A signed-out request can't exercise that specific
    // path, but it does confirm the route is gated at all (redirects to
    // /login) rather than being publicly reachable or erroring.
    const diaryResponse = await fetch(`${BASE_URL}/diary`, {
      redirect: "manual",
    });
    const diaryLocation = diaryResponse.headers.get("location") ?? "";
    if (
      ![301, 302, 303, 307, 308].includes(diaryResponse.status) ||
      !diaryLocation.includes("/login")
    ) {
      fail(
        `GET /diary (signed out) expected a redirect to /login, got status ${diaryResponse.status} location "${diaryLocation}"`,
      );
    }
    console.log(
      `PASS: GET /diary (signed out) -> ${diaryResponse.status} redirect to ${diaryLocation}`,
    );

    console.log(
      "\nverify-standalone: PASS — the standalone server serves pages and " +
        "static assets. This does not check any authenticated/signed-in flow.",
    );
  } catch (error) {
    if (error instanceof SmokeTestFailure) console.error(serverOutput);
    throw error;
  } finally {
    child.kill();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SmokeTestFailure) {
    console.error(`\nverify-standalone: FAIL — ${error.message}`);
  } else {
    console.error("\nverify-standalone: unexpected error", error);
  }
  process.exit(1);
});
