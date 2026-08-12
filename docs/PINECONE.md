# Pinecone — semantic search

Prompt 7's scope: a real Pinecone integrated-embedding index for `games`, an
idempotent on-demand + backfillable sync pipeline from `games` → Pinecone,
and a semantic search mode on `/search`. **Recommendations and reasons, and
`recommendation_feedback`** — also listed under the Prompt 7 roadmap line —
are explicitly out of scope for this pass**, deferred to a later prompt. See
[ROADMAP.md](./ROADMAP.md) and [PROJECT_STATE.md](./PROJECT_STATE.md) for
the exact completion status.

## Coverage: cached games only, not the wider IGDB catalogue

**Semantic search only finds games that are already in Savepoint's
Supabase `games` cache _and_ synced to Pinecone.** It does not search
IGDB's full catalogue — a game that has never been imported into Savepoint
(via `/games/[slug]`, `addListItemAction`, or the backfill script) has no
Pinecone record and cannot be a semantic-search hit, no matter how well it
would match the query. This is the intended behavior of the on-demand
cached-game indexing architecture approved for this prompt, not a defect:
the sync pipeline (`src/lib/pinecone/sync.ts`) only ever syncs rows already
present in `game_vector_sync`, which itself only ever gets a row when a
game is imported from IGDB into Supabase (see "Why no migration" below).
Confirmed directly by manual browser testing — as of this writing only the
5 games synced by the bounded Phase B backfill are semantically
searchable; nothing else in IGDB is. Lexical search (`/search`'s default
mode) is unaffected by this — it still falls back to a live IGDB query for
titles not yet cached locally, exactly as it did before this prompt.
Broadening coverage would mean either importing more games individually
(organic, as users browse/list them) or running a larger backfill/bulk
IGDB catalogue ingestion — neither is in scope for this pass.

## Why no migration

`game_vector_sync` has existed since migration 6
(`20260811122500_create_activity_and_recommendation_tables.sql`), part of
the original Prompt 1 schema — `game_id uuid primary key references
games(id) on delete cascade`, `status text check in ('pending', 'synced',
'failed')`, `last_attempted_at`, `last_synced_at`, `attempt_count`, `error`,
`updated_at`. RLS is enabled with **zero policies and zero grants** for
`anon`/`authenticated` — the only access path is the service-role admin
client, confirmed in migrations 6/14/16 and `scripts/verify-schema.mts`.
Every IGDB import already upserts a `pending` row here (`src/server/
services/game-sync.ts`). This prompt needed no schema change at all — the
entire concurrency-safe sync design (below) is built from these existing
columns.

## Index bootstrap — a hard separation between "describe" and "create"

**Application runtime code never creates, deletes, or mutates the Pinecone
index.** `src/lib/pinecone/client.ts`'s `ensureConfiguredIndex()` only calls
`describeIndex()` and validates the result (`src/lib/pinecone/
index-compat.ts`'s `isIndexCompatible()`, checking `embed.model ===
"llama-text-embed-v2"` and `embed.fieldMap.text === "text"`) — on a missing
or incompatible index it throws a typed error and stops; it never deletes or
recreates anything.

The **only** code path in the repository permitted to call
`createIndexForModel` is `scripts/pinecone-bootstrap.mts`, run manually:

```bash
npm run pinecone:bootstrap
```

A read-only preflight variant (`--check`, alias `--dry-run`) fully loads
every module, validates env vars, authenticates, and lists/describes
indexes — it never creates, deletes, configures, or upserts anything,
regardless of what it finds:

```bash
npm run pinecone:bootstrap -- --check
```

It describes first; creates only if genuinely missing (`cloud: "aws"`,
`region: "us-east-1"` — Starter-plan compatible — `embed: {model:
"llama-text-embed-v2", fieldMap: {text: "text"}}`, `deletionProtection:
"enabled"`); if an index with this name already exists but is incompatible,
it reports the conflict and stops rather than touching it. `client.ts` has
no import path to this script or to any index-creation logic — they share
only two pure, secret-free modules (`constants.ts`, `index-compat.ts`),
since `client.ts` is `server-only` and a plain-Node script can't import a
`server-only` module (its package body is an unconditional `throw`, only
neutralized by Next's bundler).

`PINECONE_INDEX_NAME` defaults to `savepoint-games`; the namespace is
`games`. Both already declared in `src/lib/env.server.ts` and
`docs/ENVIRONMENT.md` — no env changes this pass.

## Record design

- `id`: the game's internal `games.id` UUID, used as-is — stable, 1:1, no
  extra mapping needed to resolve a hit back to Supabase.
- `text` (the field mapped via `fieldMap.text`): composed by
  `src/lib/pinecone/record-text.ts`'s `buildGameEmbeddingText()` from name +
  summary/storyline + "Genres: …. Platforms: …. Modes: …. Themes: ….
  Keywords: …." (keywords is the real `games.keywords` column — `text[]`,
  capped at 10, populated by `src/lib/igdb/mappers.ts` from IGDB's own
  keyword list — not invented data). Truncated to `MAX_TEXT_CHARS` (~6000
  chars) at a word boundary — defense in depth on top of Pinecone's own
  `truncate: "END"` default for `llama-text-embed-v2`'s 2048-token limit.
- Metadata fields (`buildGameRecordFields()`): `game_id` (duplicated from
  `id` because `searchRecords` results only return whatever's requested in
  `fields`, not the top-level record id), `igdb_id`, `slug`, `name`,
  `release_year` (derived from `release_date`), `genres`/`platforms` (names,
  capped at 5 each), `cover_image_id`. **No user data, no reviews, no
  emails** — game namespace only. Pinecone metadata values can't be `null`
  (`RecordMetadataValue = string | boolean | number | string[]`), so
  nullable inputs (`release_year`, `cover_image_id`) are **omitted** from
  the field set rather than coerced to a sentinel.

Pinecone's own limits (confirmed against the installed
`@pinecone-database/pinecone` SDK's docs, not assumed): `llama-text-embed-v2`
supports a max sequence length of 2048 tokens and a max batch size of **96
records** per upsert call when using text-based integrated embedding — the
sync pipeline never exceeds this (`MAX_RECORDS_PER_UPSERT`).

## Concurrency-safe sync — a recoverable lease built from existing columns

The naive approach — guard a claim on `attempt_count` alone — isn't
exclusive: worker A bumps `attempt_count` 0→1 and starts its Pinecone call;
worker B can then read `attempt_count = 1`, bump it 1→2, and _also_ start a
Pinecone call for the same game. The fix is a proper time-boxed lease: a
claim writes `status: "pending"` **and** a fresh `last_attempted_at`
together, and that specific combination — `pending` with a recent
`last_attempted_at` — **is** the "currently leased" signal a second worker
checks for and refuses to claim over, until the lease expires.

`src/lib/pinecone/sync.ts`'s `syncGameVector(gameId)` (never throws — every
failure mode resolves to a typed `SyncOutcome`):

1. **In-process dedupe wraps the entire operation**, before any status/index
   check — a module-level `Map<string, Promise<SyncOutcome>>`, same shape as
   `src/lib/igdb/token.ts`'s in-flight-request dedupe. Same-process only;
   the real cross-process guarantee is the lease below.
2. Read `game_vector_sync` (`status`, `attempt_count`, `last_attempted_at`).
3. **Eligibility** (no writes yet):
   - `synced` → `skipped_already_synced`.
   - `failed` at or past `MAX_AUTO_RETRY_ATTEMPTS` (5) and no override →
     `skipped_retry_exhausted`. **Applies to request-triggered syncs too**,
     not just the backfill — a permanently-failed row isn't retried just
     because its game page gets viewed again.
   - `pending` with a `last_attempted_at` inside `SYNC_LEASE_MS` (5 min) →
     `skipped_concurrent` — another worker's claim is still active.
   - `failed`, under the cap, with a `last_attempted_at` inside
     `RETRY_COOLDOWN_MS` (15 min, distinct from and longer than the lease) →
     `skipped_cooldown`.
   - Otherwise eligible: `pending` with `last_attempted_at === null` (never
     attempted, or freshly reset by an IGDB re-import — see below), or an
     _expired_ lease; or `failed`, under the cap, outside cooldown.
4. **Only for an eligible row**, call `ensureConfiguredIndex()`. A missing
   or incompatible index (`PineconeIndexUnavailableError`) is a _global_
   problem, not this game's fault — it returns `{status: "deferred",
reason}` and **leaves the row completely untouched**: no claim, no
   `attempt_count` increment. This is what stops an unbootstrapped index
   from burning every game's retry budget the moment anyone views a page.
5. **Claim**: one captured `claimTimestamp`, atomically written together
   with `attempt_count + 1` and `status: "pending"`, guarded by
   `.eq("attempt_count", previousCount)`. Zero rows affected → another
   worker claimed first → `skipped_concurrent`, **no Pinecone call is made
   by the loser.**
6. The claiming worker fetches the game row + tagged refs
   (`src/server/services/game-refs.ts`), builds the record, calls
   `upsertRecords`.
7. **Final write, conditional on both the claimed `attempt_count` _and_ the
   exact `claimTimestamp`.** This double guard is what protects against a
   slow, expired worker: if the lease expired mid-flight and a _newer_
   worker reclaimed the row, the old worker's write matches neither
   condition and is silently discarded instead of clobbering the newer
   result.
8. A crash between steps 5 and 7 simply leaves the row `pending` with an
   aging `last_attempted_at` — the next request or backfill run reclaims it
   once `SYNC_LEASE_MS` passes. No manual recovery step.

**`src/server/services/game-sync.ts`'s `upsertGameFromIgdbDetail()`**
upserts `game_vector_sync` to `{game_id, status: "pending",
last_attempted_at: null}` on every import/refresh — the explicit
`last_attempted_at: null` reset is required under the lease design, since a
game re-imported shortly after its previous sync attempt would otherwise
still carry a recent `last_attempted_at` and look like it's under an active
lease. `attempt_count`/`error`/`last_synced_at` are deliberately **not**
touched — preserved as historical record (a game that exhausted its retry
cap stays subject to that cap even after a routine re-import, unless an
operator explicitly retries it with `--retry-permanent-failures`).

## `after()` — best-effort, confirmed request contexts only

Not called inside `upsertGameFromIgdbDetail()` (a generic, reusable helper
with no guarantee its caller is a live request — deliberately kept callable
from anywhere, including tests, without an `after()` dependency). Scheduled
only at the two confirmed dynamic request call sites, both already
force-dynamic (they read the session):

- `src/app/games/[slug]/page.tsx`, after `getOrImportGameBySlug` resolves.
- `src/server/actions/lists.ts`'s `addListItemAction`, after
  `importGameByIgdbId` succeeds.

Both: `after(() => { syncGameVector(gameId).catch(() => {}); })`. Calling
this unconditionally on every resolved game is cheap because of the
`skipped_already_synced`/`skipped_retry_exhausted` short-circuits — most
calls do zero Pinecone/claim work. `after()` is explicitly **best-effort
only** — if the process exits before the callback completes, the row stays
`pending`/`failed` and the resumable backfill script is the real recovery
mechanism. Server Actions never execute during `next build`; `/games/
[slug]` is confirmed non-static (checked in the `next build` output, not
assumed) — `after()` never fires at build time.

## Backfill script

```bash
npm run pinecone:backfill -- [--limit N] [--retry-permanent-failures]
```

Resumable and bounded (`--limit`, default 200). Reimplements the exact same
lease protocol as `sync.ts` inline (can't import a `server-only` module from
a plain-Node script) — claim before any Pinecone work, final writes
conditional on both the claimed `attempt_count` and the exact claim
timestamp. A broad candidate query (`status in ('pending', 'failed')`) is
deliberately coarse; the per-row eligibility check is what actually filters
out currently-leased, in-cooldown, or retry-exhausted rows, so counts for
each skip reason are reported in the run summary.

- `--retry-permanent-failures` bypasses only the retry-exhausted check
  (rows at or past `MAX_AUTO_RETRY_ATTEMPTS`) for that run — the cooldown
  check still applies even then, a deliberate scope limit (the flag means
  "allow retrying permanent failures," not "ignore all pacing").
- **Self-concurrency lock**: a PID file at
  `path.join(os.tmpdir(), "savepoint-pinecone-backfill.lock")` — outside any
  tracked source path, so no `.gitignore` entry is needed. A live PID
  refuses a second overlapping run; a stale lock (dead PID) is reclaimed
  automatically. Matches this project's documented single-instance
  deployment assumption (the same one `src/lib/rate-limit.ts` states).
- Never creates the index — if missing or incompatible, it exits and points
  the operator at `npm run pinecone:bootstrap`.
- Transient Pinecone failures (network/5xx/429) retry up to 3 times with
  backoff within the run before being recorded `failed`.
- Prints synced/failed/skipped-by-reason counts and, at the end, the index
  name, namespace, and live record count (`describeIndexStats()`) — no
  credential values ever printed.

## Semantic search

**Explicit Supabase boundary**: `src/lib/pinecone/search.ts`'s
`searchGameIds(query, topK)` has **no Supabase dependency at all** — it
returns ordered `{gameId, score}` pairs only, never touching Supabase or
receiving a client. `src/server/services/semantic-search.ts`'s
`searchGamesSemantic(supabase, {query, topK, clientId})` is the only place
that turns those ids back into real rows — `supabase` is always the
caller's request-scoped, RLS-authenticated client (passed in by
`/search/page.tsx`, never an admin client, never an internally-constructed
or global one; `games` is public-readable so no elevated access is ever
needed).

1. Zod-validates `query`/`topK` (`src/lib/validation/games.ts`'s
   `semanticSearchQuerySchema`/`semanticSearchTopKSchema`) before any
   Pinecone call. Invalid input returns empty results directly.
2. Rate-limits via the existing `checkRateLimit()` convention (mirrors
   `getOrImportGameBySlug`'s embedded pattern): bucket
   `semantic-search:${clientId}`, 20/min. **On limit exceeded, degrades
   straight to lexical fallback — no error surfaced.**
3. Calls `searchGameIds()`. Any thrown Pinecone error (missing/incompatible
   index, network failure) is caught and degrades to lexical fallback — no
   internal error text ever reaches the response.
4. On success: one batched `supabase.from("games").select(...).in("id",
gameIds)`, reordered to match Pinecone's hit order, with any id Pinecone
   returned that Supabase no longer has silently dropped (see below).
5. Fallback calls the existing `searchLocalGames()` (not the IGDB-augmented
   `searchGames()` — a fallback shouldn't trigger a live IGDB call).

`/search/page.tsx` gains a `mode` searchParam (`lexical` default |
`semantic`) via two plain `<Link>`s preserving `q` — zero client JS. A small
inline notice renders only when the outcome's mode is `lexical_fallback`.
The Cmd+K `search-command-dialog.tsx` and `add-game-to-list-dialog.tsx` are
untouched — natural-language queries don't fit their debounced-autocomplete
UX, and "global search experience" maps to the dedicated `/search` page.

## Stale/orphan vector handling

Supabase remains authoritative.

- **Search-time**: already handled structurally — `searchGamesSemantic`
  drops any Pinecone-returned id Supabase no longer has before results ever
  reach a user. This is a read-time self-heal, not a fix.
- **Storage-time** (orphaned Pinecone records after a `games` row is
  deleted): **not implemented this pass** — no delete-trigger/hook is
  added. Known, accepted gap. Future reconciliation approach: a periodic
  maintenance script comparing Pinecone's full record-id set for the
  `games` namespace (via `listPaginated`/namespace iteration) against the
  live `games.id` set, deleting ids with no matching row — described here,
  not built, since it wasn't requested this pass.

## Error handling — allow-listed classification, not blacklist redaction

`src/lib/pinecone/error-sanitizer.ts`'s `sanitizeErrorForStorage()` maps
known Pinecone SDK error classes (`PineconeAuthorizationError`,
`PineconeNotFoundError`, `PineconeTimeoutError`, etc.) to a fixed, static
label — **never** the SDK's own `.message` or response body, some of which
embed request URLs. Unrecognized errors fall back to one static string,
zero interpolated content. A secondary regex scrub (bearer tokens,
`Authorization`/`Api-Key` headers, credentials-in-URL) runs over the small,
fixed set of strings this module can ever produce, as defense in depth.
Always ≤200 characters, stored in `game_vector_sync.error`.

## Security

- `client.ts`, `sync.ts`, `search.ts` all `import "server-only"`;
  `constants.ts`, `index-compat.ts`, `record-text.ts`, `error-sanitizer.ts`
  stay pure so the plain-Node scripts can import them.
- `PINECONE_API_KEY` never leaves `env.server.ts` (or the scripts' own
  `process.env` reads); never logged.
- No user-supplied filter objects reach `searchRecords` — the only input is
  the validated free-text `query.inputs.text` string.
- `game_vector_sync` writes stay exclusively through `createAdminClient()`
  (app sync) or the scripts' own inline admin client (bootstrap/backfill/
  smoke-test); semantic search stays exclusively through the request-scoped
  client. No new grants, no RLS changes, no migration.
- No Pinecone SDK call exists at module scope anywhere in the app.
  `createIndexForModel` is called from exactly one file
  (`scripts/pinecone-bootstrap.mts`), which the app's module graph never
  imports.
- The created index has `deletionProtection: "enabled"` (a real field on
  the installed SDK's `CreateIndexForModelOptions`) — an extra guard on top
  of the fact that nothing in this codebase ever calls `deleteIndex`.

## `npm run pinecone:smoke-test`

Read-only Phase B verification tool. Runs the three example queries
("atmospheric science-fiction exploration", "cosy farming game with
relationships", "difficult tactical RPG with meaningful choices") against
the real configured index, printing query text, resolved game names/ids/
slugs, scores, and a safe summary — never credentials, never a raw error
body.

## Standalone script module resolution

The three `scripts/pinecone-*.mts` files run under Node's native TypeScript
type-stripping (this project's Node 24 engine), the same runner the other
`scripts/*.mts` files already use — no bundler-adjacent runner (e.g. `tsx`)
was added. Unlike webpack/Vite, Node's ESM resolver does not infer a
missing file extension, so **every relative import these scripts touch,
directly or transitively, must carry an explicit `.ts` extension** — e.g.
`src/lib/pinecone/index-compat.ts` importing its own sibling `constants.ts`
needs `from "./constants.ts"`, not `from "./constants"`. `tsconfig.json`'s
`allowImportingTsExtensions` already permits this project-wide. The
`MODULE_TYPELESS_PACKAGE_JSON` warning Node prints for these `.ts` files is
expected and left as-is — it's advisory only (Node's module auto-detection
correctly reparses the ESM syntax regardless), and these modules are shared
with the Next.js app itself, so declaring a package-wide module type
purely to silence one script's warning would be a disproportionate change.

`pinecone-backfill.mts`'s self-concurrency lock release also depends on
never calling `process.exit()` from inside `main()`'s `try` block — doing
so terminates the process immediately without unwinding the stack, skipping
`finally { releaseLock() }` and leaking the lock file. Failure paths inside
`getNamespace()`/`fetchCandidates()` throw instead; a top-level
`try { await main(); } catch { process.exitCode = 1; }` sets the exit code
after the lock has already been released.

## Live verification (Phase B, real index)

Run in order against the real, user-bootstrapped `savepoint-games` index:

1. `npm run pinecone:bootstrap -- --check` — confirmed the index exists,
   is compatible, `deletionProtection: enabled`.
2. `npm run pinecone:backfill -- --limit 5` — **5 candidates, 5 claimed, 5
   synced, 0 failed, 0 skipped**.
3. `npm run pinecone:smoke-test` — 3 queries, **15 hits, 0 failures**,
   every hit resolved to a real Supabase `games` row (name/slug/uuid
   printed for each — no stale-index-entry lines).
4. Final state: **index `savepoint-games`, namespace `games`, 5 records**
   (`describeIndexStats()`, printed at the end of the backfill run). No
   credential values or raw upstream error bodies were printed at any step.

No index create/delete/reconfigure happened during Phase B (only the
user's own prior bootstrap run did that), and no more than the bounded
5-game batch was upserted.

**Manual browser verification (passed):** semantic mode loads, results
render from the live index, no lexical-fallback warning appeared, the
Standard/Semantic toggle works, no browser error page appeared. Testing
also confirmed the coverage limitation described above — searches only
surface the 5 backfilled games, not the wider IGDB catalogue — as expected
behavior, not a defect.
