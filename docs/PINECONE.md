# Pinecone — semantic search

Prompt 7's scope: a real Pinecone integrated-embedding index for `games`, an
idempotent on-demand + backfillable sync pipeline from `games` → Pinecone,
and a semantic search mode on `/search`. **Recommendations and reasons, and
`recommendation_feedback`** — also listed under the Prompt 7 roadmap line —
are explicitly out of scope for this pass**, deferred to a later prompt. See
[ROADMAP.md](./ROADMAP.md) and [PROJECT_STATE.md](./PROJECT_STATE.md) for
the exact completion status.

## Coverage: cached games, plus (as of Prompt 7C's Gate A2) infrastructure for a broad catalogue slice not yet turned on

**Historically, semantic search only found games already in Savepoint's
Supabase `games` cache _and_ synced to Pinecone.** Prompt 7C (see
"Broad catalogue indexing" below) builds the infrastructure to change
that — searching a curated, IGDB-wide slice of ~25–29K real, rated games
regardless of whether Savepoint has ever cached them — but as of Gate A2,
**no catalogue-wide discovery or indexing has actually run.** Coverage
today is still exactly what it was: only games imported into Savepoint
(via `/games/[slug]`, `addListItemAction`, the catalogue-only "Open full
search" POST import, or the on-demand backfill script) are searchable.
Gates B through E — profile selection, a canary, a bounded expansion, and
finally a full background sync — each require a separate, explicit
approval before any real IGDB discovery or Pinecone catalogue upsert
happens; see "Broad catalogue indexing" for the gate-by-gate plan and
current status. Lexical search (`/search`'s default mode) is unaffected
either way — it still falls back to a live IGDB query for titles not yet
cached locally.

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

## Record design (schema v2 — Prompt 7C)

- `id`: **`igdb-${igdbId}`**, not the game's Supabase UUID. Changed in
  Prompt 7C: most catalogue candidates never get a Supabase row at all, so
  the record id had to become independent of one. `igdb_id` is a plain
  number present in metadata on **every** record regardless of schema
  version (it was already there in the original v1 shape), which is what
  makes hydration (below) work identically for old and new records without
  needing to know which shape produced a given hit.
- `schema_version`: `2` (the `PINECONE_SCHEMA_VERSION` constant,
  `src/lib/pinecone/constants.ts`). **Absent on every record written before
  Prompt 7C** — the field itself is how a legacy record is told apart from
  a current one. See "v1 → v2 compatibility" below.
- `text` (the field mapped via `fieldMap.text`): composed by
  `src/lib/pinecone/record-text.ts`'s `buildGameEmbeddingText()` from name +
  summary/storyline + "Genres: …. Platforms: …. Modes: …. Themes: ….
  Keywords: …." (keywords is the real `games.keywords` column — `text[]`,
  capped at 10, populated by `src/lib/igdb/mappers.ts` from IGDB's own
  keyword list — not invented data). Truncated to `MAX_TEXT_CHARS` (~6000
  chars) at a word boundary — defense in depth on top of Pinecone's own
  `truncate: "END"` default for `llama-text-embed-v2`'s 2048-token limit.
- Metadata fields (`buildGameRecordFields()`): `schema_version`, `igdb_id`,
  `slug`, `name`, `genres`/`platforms`/`game_modes` (names, capped at 5
  each — `game_modes` new in v2), `release_year` (derived from
  `release_date`), `cover_image_id`, `igdb_updated_at` (unix seconds, new
  in v2 — drives incremental discovery's watermark; omitted when
  unavailable, e.g. the on-demand path doesn't make an extra IGDB call
  just for this field). **`game_id` (the v1 Supabase-UUID field) is
  dropped** — no remaining reader needs it once hydration resolves by
  `igdb_id`. **No user data, no reviews, no emails** — game namespace
  only. Pinecone metadata values can't be `null`
  (`RecordMetadataValue = string | boolean | number | string[]`), so every
  optional field is **omitted** from the field set rather than coerced to
  a sentinel.

### v1 → v2 compatibility

The 9 live records as of Gate A2 all still use the v1 shape (raw-UUID
`id`, no `schema_version`). Nothing force-migrates them:

- `syncGameVector`'s "already synced, skip" check now also requires
  `game_vector_sync.schema_version = PINECONE_SCHEMA_VERSION` (a new
  nullable column, migration `20260813120000`) — a `'synced'` row with a
  `NULL` or older `schema_version` is **re-synced, not skipped**, on its
  very next on-demand trigger (a page view, a list-add, a catalogue-only
  import). This decouples Pinecone _schema_ freshness from the unrelated
  14-day IGDB _content_ staleness TTL — a legacy record self-heals on next
  touch, not "eventually."
- Search-time dedupe: `semantic-search.ts` dedupes hits by `igdb_id`,
  keeping the highest-ranked occurrence — safe even if a v1 and v2 record
  for the same game briefly coexist during the transition.
- `status` (the catalogue-sync operator command) reports both the count of
  `game_vector_sync` rows still below the current `schema_version` and a
  bounded scan of remaining UUID-shaped Pinecone record ids, as visibility
  aids — never auto-deletes anything. Actual cleanup of stale v1 records
  requires separate, explicit future approval.

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
4. On success: one batched `supabase.from("games").select(...).in("igdb_id",
igdbIds)` — **`igdb_id`, never `id`**. Hydrating by the Supabase UUID
   column stopped being safe once v2 records exist: a v2 hit's own record
   id is `igdb-${igdbId}`, and passing that into an `.in("id", ...)`
   filter against a `uuid` column throws a real Postgres
   `invalid input syntax for type uuid` error rather than gracefully
   returning nothing. `igdb_id` is a plain integer column, correct for
   both v1 and v2 hits, with no type mismatch either way. Results are
   reordered to match Pinecone's hit order; a hit whose `igdb_id` matches
   no Supabase row renders instead from its own validated Pinecone
   metadata as a catalogue-only result (see "Catalogue-only rendering"
   below) rather than being dropped; the set is deduped by `igdb_id`,
   keeping the first (highest-ranked) occurrence.
5. Fallback calls the existing `searchLocalGames()` (not the IGDB-augmented
   `searchGames()` — a fallback shouldn't trigger a live IGDB call).

### Catalogue-only rendering and the on-demand import boundary (Prompt 7C)

A hit with no matching Supabase row is validated against
`pineconeCatalogueRecordSchema` (`src/lib/validation/games.ts`) — a
legacy v1 hit (no `schema_version`) or an incomplete/corrupt record fails
validation and is dropped, same fail-safe behavior as before, just
narrowed to only the cases that still can't be resolved. A valid one
renders as `{ source: "igdb", igdbId, slug, name, coverImageId,
releaseYear }` — the same shape `PosterCard` already renders for
lexical-fallback "uncached IGDB result" items.

**Opening an uncached catalogue result is a POST, not a GET-triggered
`<Link>`.** `/games/[slug]`'s existing on-demand import (rate-limited,
idempotent, race-safe) is sound and unchanged, but linking catalogue-only
results straight to it the way lexical fallback does would make
~25–29K additional real, legitimate, semantically-discoverable game URLs
newly reachable through Savepoint's own UI — a materially larger,
crawlable, write-triggering GET surface than today's small,
effectively-interactive-only set (`prefetch={false}` is a Next.js client
hint a plain bot GET ignores). Instead:

- `src/server/actions/games.ts`'s `importCatalogueGameAction` — a real
  Server Action, rate-limited via `checkCatalogueImportRateLimit`
  (`src/server/services/game-sync.ts`, same shape as the existing
  `game-import:` bucket, separately keyed as `catalogue-import:` so the
  two paths' budgets can't cross-exhaust), calls the existing
  `importGameByIgdbId` (zero new import logic), then `redirect()`s to the
  canonical `/games/[slug]` page.
- `src/components/games/catalogue-result-card.tsx` — visually matches
  `PosterCard`, but is a real `<form><button type="submit"></form>`
  instead of a `<Link>`.
- `/search/page.tsx`'s semantic-mode results render cached hits via the
  existing `PosterGrid`/`PosterCard` path and catalogue-only hits via
  `CatalogueResultCard`, in one combined grid preserving Pinecone's
  overall rank order.

**Disclosed, deliberate scope limit**: this POST boundary covers only the
_new_ catalogue-only semantic results. The smaller, already-shipped
lexical-fallback GET-import path (`/api/search`'s uncached results) is
unchanged — retrofitting it wasn't required to fix the much larger
exposure this prompt introduces, and doing so would mean touching shared,
already-reviewed search-dialog/`PosterCard` behavior outside this
prompt's stated scope. Worth a separate future look, not addressed here.

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

## Broad catalogue indexing (Prompt 7C)

Infrastructure for indexing a broad, curated slice of the IGDB catalogue —
not just games Savepoint has cached — built across Gate A1/A2. **No real
discovery or catalogue upsert has run.** Gates B–E each require a
separate, explicit approval before any live IGDB scan or Pinecone
catalogue write happens.

### Catalogue profile and real numbers (Gate B candidate figures)

IGDB's raw catalogue is enormous and mostly noise — 371,859 games total,
and even a type-filtered "released main games" slice is 200K+ records
dominated by zero-engagement hobby entries. A `total_rating_count >= 1`
filter (at least one real rating) cuts that by ~84%. Three profiles
(`src/lib/igdb/catalogue-profile.ts`'s `CATALOGUE_PROFILES`), live-counted
2026-08-12:

| Profile                  | Definition                            | Count  |
| ------------------------ | ------------------------------------- | ------ |
| `conservative`           | Main Game only, rated                 | 25,079 |
| `balanced` (recommended) | +Remake/Remaster/Expanded Game, rated | 26,676 |
| `broad`                  | excl. Bundle/Mod/Fork/Pack, rated     | 29,237 |

All three additionally require `first_release_date <= now`, a cover
image, and a summary or storyline. Game-type ids are **never hardcoded**
— every profile filter resolves live against IGDB's own `game_types`
endpoint at run time. **Final profile choice is a Gate B decision**, not
made in Gate A.

### Quota math — two separate constraints

Originally confirmed against `docs.pinecone.io`/`pinecone.io/pricing` on
2026-08-12 for the **Starter (free)** plan. The organization has since
been **upgraded to Builder** (confirmed by the account owner, not
independently re-verified against the public pricing page this pass):

| Resource                                         | Starter (original) | Builder (current)                                |
| ------------------------------------------------ | ------------------ | ------------------------------------------------ |
| Storage                                          | 2GB                | 2GB (unchanged, per account owner)               |
| Write Units                                      | 2M/month           | 2M/month (unchanged, per account owner)          |
| Read Units                                       | 1M/month           | 1M/month (unchanged, per account owner)          |
| Embedding tokens (llama-text-embed-v2), monthly  | 5,000,000          | **10,000,000**                                   |
| Embedding tokens, passage/upsert, **per-minute** | **250,000**        | **250,000 (unchanged)**                          |
| Overages                                         | N/A (free tier)    | Flat-rate — no usage overages, per account owner |

`PINECONE_PASSAGE_TOKENS_PER_MINUTE_LIMIT`/`_TARGET` in `constants.ts`
are unaffected by the upgrade (the per-minute figure didn't change) and
were **not** modified. Only the monthly-budget math below changes.

Storage/WU/RU are not binding at any profile size (~130MB max). Under
Builder, a one-time initial sync of the `balanced` profile
(~4.27M raw / ~5.55M safety-margined tokens, `EMBEDDING_TOKEN_SAFETY_
MULTIPLIER = 1.3`, absorbing the ±30% uncertainty in the chars/4 token
estimate) fits comfortably in a single monthly window (~56% of the
10M/month budget) — Gate E no longer strictly requires splitting across
multiple months, though doing so anyway remains a reasonable operational
choice. Separately, **any run, regardless of size**, must still pace its
Pinecone upserts to avoid bursting past 250,000 tokens/minute (unchanged
by the plan upgrade) — `src/lib/pinecone/embed-rate-pacer.ts`'s
`EmbedRatePacer` paces to `PINECONE_PASSAGE_TOKENS_PER_MINUTE_TARGET`
(150,000, 60% of the limit), deliberately leaving headroom for concurrent
ordinary Savepoint traffic sharing the same project-level allowance —
`Retry-After`/backoff on real `429`s remains a backstop for whatever the
proactive estimate misses.

### Schema and ledger (migration `20260813120000`)

One additive migration, applied and live-verified (see below):

- `game_vector_sync.schema_version` — additive nullable column (§ above).
- `igdb_catalogue_discovery_cursor` — one row per named cursor
  (`discover:<profile>:gen<N>`, `incremental:<profile>`,
  `release-check:<profile>`), tracking each cursor kind's own watermark
  columns plus `last_applied_page_key` (the compare-and-set pointer,
  below) and `candidates_discovered` (a **per-cursor scan-progress
  counter** — never summed across cursors as "total coverage"; true
  coverage is always `select count(*) from igdb_catalogue_sync`).
- `igdb_catalogue_sync` — the per-IGDB-game ledger, PK `igdb_id` (no FK to
  `games` — most rows describe a game never cached), status
  `pending|synced|failed|ineligible`, same claim/lease/finalize
  optimistic-lock protocol as `game_vector_sync`.
- `igdb_catalogue_lease` — a single-row singleton, seeded by the
  migration. One durable, fenced, heartbeat-renewed lease shared by
  **every** mutating catalogue command — `discover`/`sync`/`incremental`/
  `release-check` can never run concurrently with each other or
  themselves. `src/lib/pinecone/lease.ts`'s `CatalogueLease` (acquire:
  conditional UPDATE on `token is null or lease_until < now()`; renews
  every 90s; a lost lease is detected at most one heartbeat late — callers
  must still check `isHeld()` before every batch, not just trust the
  interval; releases conditionally on the held token).
- `advance_catalogue_discovery(...)` — the one atomic checkpoint RPC for
  every discovery-family write. `SECURITY INVOKER`, not `DEFINER` (the
  only caller is always `service_role`, which already bypasses RLS
  regardless of the function's security mode — no privilege-escalation
  risk to take on). `set search_path = ''`, every reference fully
  qualified. `REVOKE`/`GRANT` use the complete parameter-type signature on
  every statement, never a bare function name. Live-verified: `anon`
  rejected end-to-end through PostgREST; `authenticated`'s rejection
  confirmed by the migration's own `do $$ ... $$` assertion block (it
  could not have applied otherwise).
  - **Real compare-and-set**, not a duplicate check: the caller passes
    both `p_page_key` (this page's own deterministic key —
    `src/lib/pinecone/catalogue-page-key.ts`, a hash over the complete
    canonical mutation payload: every candidate's metadata, the
    ineligible-id set, every compound cursor value, and the completion
    flag — not candidate ids alone) and `p_expected_previous_page_key`
    (what the caller believes the cursor's current pointer is). An exact
    repeat short-circuits to `already_applied`; a mismatch is rejected as
    stale/out-of-order, no mutation. Live-verified: page A, page B, retry
    of B (no-op), a delayed retry of A arriving after B (rejected), and a
    wrong lease token (rejected before any mutation) all behave exactly
    as designed.
  - Candidates are deduplicated by `igdb_id` inside the RPC (a `distinct
on` CTE) before touching the ledger — a page with a repeated
    `igdb_id` can't make the `ON CONFLICT` upsert try to affect one row
    twice. `xmax = 0` on the `RETURNING` row distinguishes a genuine
    insert from an update in one atomic pass, giving both
    `candidates_encountered` (persisted into `candidates_discovered`) and
    `new_ledger_rows` (returned for the caller's own logging, never
    persisted — the ledger table is always the source of truth for a true
    global count) without a separate pre-check query.
  - `igdb_updated_at`/watermark fields are always converted from IGDB's
    Unix-seconds representation via `to_timestamp()` — never a raw
    `::timestamptz` cast, which silently mis-converts a bare integer.
    Live-verified round-trip correct, including two rows sharing an
    identical timestamp persisting distinctly (the ORDER BY tie-break
    itself is a pure unit test — `catalogue-profile.test.ts`).

### Discovery, incremental, and release-check

- **`discover`** — id-ordered, server-side profile-filtered (efficient:
  ~54 requests for the `balanced` profile's initial sweep vs. ~744 for an
  unfiltered scan). Cursor `discover:<profile>:gen<N>` — a full rescan is
  an explicit `--new-generation` bump to a fresh cursor row, never a
  silent reset; nothing is ever deleted, so a new generation's
  resumability is independent of prior ones.
- **`incremental`** — scans IGDB itself by a tie-safe `(updated_at, id)`
  watermark, **without** the profile filter server-side (eligibility is
  evaluated client-side per row via `isEligibleForCatalogue`, the same
  predicate `discover`'s server-side `where` clause encodes numerically —
  kept in agreement by a dedicated unit test). This is what catches a
  previously-ineligible old game becoming eligible, an update to an
  already-indexed game, and a game becoming ineligible, all through one
  mechanism. A fixed `INCREMENTAL_OVERLAP_SECONDS` (300s) safety window
  means the watermark never advances past `scanStartedAt - 300s`, so
  every run re-examines a small, cheap, idempotent buffer. **Documented,
  not proven, assumption**: relies on IGDB bumping `updated_at` for any
  eligibility-relevant change (including rating aggregation) — flagged
  for an empirical spot-check before relying on it operationally; the
  generation-based `discover` rerun is the fallback if it's ever wrong.
- **`release-check`** — the dedicated fix for a game becoming eligible
  purely because _time passed_ (`first_release_date <= now` crossing
  true), which neither `discover` (a snapshot) nor `incremental`
  (assumes something about the row changed) is guaranteed to catch.
  Tie-safe `(first_release_date, id)` watermark, same overlap-window
  pattern. **Initialization**: a `NULL` watermark would make
  `first_release_date > NULL` evaluate to `NULL` (never true) in
  Postgres — silently scanning nothing forever. `discover`'s first
  generation for a profile seeds this watermark once, to
  `scanStartedAt - overlap` (not "now"), before fetching its own first
  page — so a game released while the initial multi-stage sync is still
  running can't be missed. `release-check` refuses to run against an
  unseeded cursor with a clear error rather than guessing.

### Operator ceilings, pacing, and exit codes

Every `--execute` invocation of `discover`/`sync`/`incremental`/
`release-check` requires all four of `--limit`, `--max-requests`,
`--max-runtime-minutes`, `--max-estimated-embedding-tokens` — missing any
one is a hard pre-flight error; `--execute` alone never authorizes an
unbounded run. Dry-run needs none of them but honors a bare `--limit` for
a quick bounded preview. Ceilings are checked before each batch, never
mid-batch. `SIGINT`/`SIGTERM` release the lease and exit `130`/`143` —
**never 0**; exit 0 is reserved for a genuinely completed bounded run or
a designed, operator-specified ceiling stop (both distinguished in the
run summary from an interruption). Losing the lease mid-run exits `2`.

### Commands

```bash
npm run igdb:catalogue-estimate                          # Gate B, read-only
npm run igdb:catalogue-sync -- discover --profile balanced
npm run igdb:catalogue-sync -- incremental --profile balanced
npm run igdb:catalogue-sync -- release-check --profile balanced
npm run igdb:catalogue-sync -- sync
npm run igdb:catalogue-sync -- status [--max-pages N] [--max-records N]
npm run igdb:catalogue-sync -- verify [--sample N]
npm run catalogue:checkpoint-smoke-test                   # opt-in, live RPC/lease verification
```

Add `--execute` plus all four ceilings to any of the first five to
actually mutate. `status`/`verify` are read-only, bounded (never claim an
exact count from a truncated Pinecone `list()` scan — always disclose
partial vs. complete), and never touch the lease.

`discover`/`incremental`/`release-check` also accept an optional
`--page-size N` (clamped to `[1, CATALOGUE_SCAN_PAGE_LIMIT]` = 500,
default 500). **Ceilings are checked once between IGDB pages, never
mid-page** — each page lands in the ledger as one atomic RPC call. IGDB
pages at up to 500 records by default, so a small `--limit` (e.g. a
canary run) must be paired with a matching `--page-size`, or a single
page/RPC call can land far more candidates than `--limit` before the
between-page check ever gets a chance to stop it. Discovered live during
Gate C's canary dry-run (§ below).

`sync` enforces `--max-estimated-embedding-tokens` **before every
upsert**, not just between batches — `src/lib/pinecone/token-budget.ts`'s
`selectWithinTokenBudget()` trims an ordered prefix of a built batch so
its cumulative margined estimate never knowingly exceeds the caller's
remaining allowance, regardless of how `BACKFILL_BATCH_SIZE` and
`--limit` happen to compare. Anything trimmed stays claimed-but-pending
in the ledger and is picked up by the next `sync` invocation; a trim
always ends the current run (`ceiling` stop, exit 0). See "Gate C
results" below for why this was added and what it replaced.

### Known limitations

- Gates A1/A2/B/C are complete; Gates D–E remain pending, each behind a
  separate explicit approval.
- The `incremental` watermark's correctness depends on an unverified
  assumption about IGDB's `updated_at` semantics (see above).
- Storage-time orphan cleanup (a deleted `games` row leaving an orphaned
  Pinecone vector) remains unimplemented, same pre-existing gap as
  Prompt 7's original design.
- The lexical-fallback GET-import path's larger-than-catalogue-only
  surface-area asymmetry (see "Catalogue-only rendering" above) is
  disclosed, not fixed, this pass.

### Gate C results — balanced-profile canary (2026-08-12)

Real, live `discover --profile balanced --limit 25 --page-size 25
--max-requests 10 --max-runtime-minutes 15
--max-estimated-embedding-tokens 15000 --execute`, then the equivalent
`sync` run. Both completed cleanly (`limit_reached`, exit 0); lease
released after each.

| Metric                                 | Result                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| Candidates discovered                  | 25 (exactly the cap)                                                 |
| Records synced                         | 25/25, 0 build failures                                              |
| Duplicate `igdb_id`s                   | 0 (25 unique)                                                        |
| Pinecone records before → after        | 9 → 34 (25 new v2 records; 9 legacy v1 records untouched)            |
| `schema_version` on all 25 new records | 2 (confirmed via live `fetch`)                                       |
| IGDB requests used                     | 3 of 10 (`game_types` + 1 discovery page + 1 detail batch)           |
| Total embedding text                   | 46,996 chars across 25 records                                       |
| Estimated tokens (raw / margined)      | ~11,749 / ~15,274                                                    |
| Real Pinecone quota consumed           | ~0.15% of the 10M/month Builder budget, ~6% of the 250K/minute limit |

Discovery cursor `discover:balanced:gen1` is not yet `completed_at` (25
of ~26,676 balanced candidates scanned) — resuming it is exactly what
Gate D would do, picking up from `last_applied_page_key` with no re-work.

**Manual browser verification (2026-08-12, user-run against the real
canary data)** — all PASS: semantic search returned the newly indexed
catalogue games; a catalogue-only result opened successfully through the
POST import boundary; the resulting game page showed real IGDB metadata
with no fabricated community data; repeating the search after import
showed the game as a normal cached result; keyboard-only activation
worked; no unexpected browser-console errors.

**Found and fixed: the embedding-ceiling overshoot.** `BACKFILL_BATCH_SIZE`
(25) exactly matched `--limit` (25), so the whole canary landed in a
single `sync` batch before any between-batch ceiling check could act —
the margined token estimate (~15,274) came in about 1.8% over the
declared `--max-estimated-embedding-tokens 15000`. Real Pinecone-side
quota consumption was nowhere close to any actual limit either way, but
the command must never _knowingly_ send a batch over its declared
ceiling merely because batch size and `--limit` happen to coincide.
**Fixed**: `runSync` now calls `selectWithinTokenBudget()` on every
built batch before the upsert, trimming an ordered prefix to fit
`tracker.remainingTokenAllowance()`; a non-empty trim ends the run with
a `ceiling` stop (exit 0) rather than continuing, and both the raw and
margined token estimates are logged for operator visibility. Covered by
`src/lib/pinecone/token-budget.test.ts`: a full batch exceeding the
remaining allowance gets trimmed; a later batch is dynamically reduced
as the allowance shrinks across sequential calls; zero records are
selected when even the first one can't fit; a batch exactly matching the
remaining allowance is still fully accepted (`<=`, not `<`); raw and
margined estimates are reported as distinct, correctly computed values;
selection never reorders — trimming is always the ordered suffix.

### Gate D results — bounded expansion with real interruption/resume (2026-08-12)

Purpose: prove interruption, lease release, checkpoint preservation, and
clean resumption against the real IGDB/Supabase/Pinecone services, at a
larger (but still tightly bounded) scale than Gate C's canary. Preflight
(read-only): quota docs still Builder/10M-month/250K-min; index/namespace
compatible; lease free; `discover:balanced:gen1` unchanged since Gate C
(paused at 25 candidates); ledger/Pinecone reconciled. All confirmed
before any mutation.

**Discovery** — resumed `discover:balanced:gen1` (no `--new-generation`)
for exactly 100 new candidates (2 pages of 50, both 100% eligible),
picking up correctly from `id > 26`. 3 IGDB requests.

**Sync, real interruption** — a real interactive Ctrl+C, performed
manually by the operator in their own PowerShell console (a genuine
SIGINT delivered through Windows console control events is not something
this agent's tool calls can reliably reproduce — a programmatic signal
wouldn't faithfully reproduce real Ctrl+C behavior, so this was
deliberately not simulated). `Start-Transcript` captured PowerShell's own
session but — a known Windows limitation — not the native `node` child
process's own stdout, so the batch counts below are derived entirely from
live Supabase/Pinecone state, not the transcript text:

| Check                                   | Result                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Batches/records completed before signal | 2 batches, 50 records (ledger synced 25→75; Pinecone 34→84)                                     |
| Exit code                               | 130 (confirmed in transcript)                                                                   |
| Writes after signal handling began      | None — 0 of the 50 remaining rows show any claim attempt                                        |
| Lease                                   | Free (token/holder/command/acquired_at/lease_until all null)                                    |
| Unfinished records                      | 50 pending, all untouched (`attempt_count = 0`), cleanly resumable                              |
| Duplicate `igdb_id`s                    | 0 (125/125 unique in ledger; 50/50 unique among new Pinecone records)                           |
| Timestamp cross-check                   | Latest `last_synced_at`/`last_attempted_at` both fall inside the transcript's wall-clock window |

**Recalculated remaining Gate D allowance** (actual observed usage, not a reset):

| Resource              | Cap    | Consumed (discovery + interrupted sync)           | Remaining for resume |
| --------------------- | ------ | ------------------------------------------------- | -------------------- |
| Candidates discovered | 100    | 100                                               | 0 (discovery done)   |
| Records synced        | 100    | 50                                                | 50                   |
| IGDB requests         | 20     | 8                                                 | 12                   |
| Runtime               | 30 min | ~2 min                                            | 28 min               |
| Margined tokens       | 75,000 | 24,154 (measured live from the 50 synced records) | 50,846               |

**Resumed sync** — `sync --limit 50 --max-requests 12
--max-runtime-minutes 28 --max-estimated-embedding-tokens 50846
--execute`, no `--new-generation`, no reset. Completed cleanly (2 more
batches, 50 records, 0 build failures, `limit_reached`, exit 0) — the
full 100-record Gate D allocation is now synced.

**Final reconciliation**:

| Metric                                            | Result                                                                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger                                            | 125 rows total, 125 synced, 0 pending, 0 failed                                                                                                                                                    |
| Pinecone before → after (Gate D only)             | 34 → 134 (exactly +100)                                                                                                                                                                            |
| `schema_version` on all 100 new records           | 2 (confirmed via live `fetch`, 0 wrong)                                                                                                                                                            |
| Duplicate `igdb_id`s across all 100               | 0 (100/100 unique)                                                                                                                                                                                 |
| `verify --sample 100`                             | 100/100 found in Pinecone                                                                                                                                                                          |
| Lease                                             | Free                                                                                                                                                                                               |
| Total IGDB requests (discovery + both sync runs)  | 10 of 20                                                                                                                                                                                           |
| Total runtime (discovery + interrupted + resumed) | ~3 min of 30                                                                                                                                                                                       |
| Total margined tokens (both sync runs combined)   | ~47,571 of 75,000 (63%)                                                                                                                                                                            |
| Total raw tokens                                  | ~36,593                                                                                                                                                                                            |
| Token-ceiling trims triggered                     | 0 — both batches fit comfortably under their allowance every time; `selectWithinTokenBudget()` ran on every batch but had nothing to trim this run (unlike Gate C, which hit the boundary exactly) |

Discovery cursor `discover:balanced:gen1` is still not `completed_at`
(125 of ~26,676 balanced candidates scanned) — fully resumable for a
future Gate E via `last_applied_page_key`, no re-work.

**Manual browser verification (2026-08-12, user-run against the real
Gate D data)** — all PASS: semantic search returned newly discovered
catalogue-only games; a catalogue-only result rendered as a form/button
rather than a normal GET link; selecting it issued a POST and redirected
successfully to `/games/<slug>`; the imported page displayed real IGDB
metadata with no fabricated ratings, reviews, or activity; repeating the
semantic search rendered the imported game as a normal cached result;
keyboard-only activation of another catalogue-only result worked; no
unexpected browser-console errors.

No live catalogue sync has run since this report — Gate E remains
unauthorized.

### ZimaOS scheduling (documented only — not wired)

Once past initial catalogue sync, `incremental`/`release-check` are
natural cron candidates (e.g. daily) for ongoing coverage. Actual
cron/tunnel/deployment wiring is explicitly deferred to the ZimaOS
deployment milestone (Prompt 8's remaining scope) — `CRON_SECRET`
already exists in `env.server.ts`, reserved for that future endpoint;
nothing in Prompt 7C depends on it or wires it up.
