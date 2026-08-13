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

- Gates A1–D are complete. Gate E is **in progress, not finished** —
  `discover:balanced:gen1` has fully scanned the profile (26,676
  candidates, `completed_at` set), but only 6,100 of those are synced to
  Pinecone as of the 2026-08-12 Gate E session below; 20,576 remain
  `pending` for a future bounded continuation (sync-only — discovery is
  already done, no re-scan needed).
- The `incremental` watermark's correctness depends on an unverified
  assumption about IGDB's `updated_at` semantics (see above).
- Storage-time orphan cleanup (a deleted `games` row leaving an orphaned
  Pinecone vector) remains unimplemented, same pre-existing gap as
  Prompt 7's original design.
- The lexical-fallback GET-import path's larger-than-catalogue-only
  surface-area asymmetry (see "Catalogue-only rendering" above) is
  disclosed, not fixed, this pass.
- This project's PostgREST config caps any row-_returning_ Supabase query
  at 1000 rows regardless of the client's requested `.limit()`/`.range()`
  width — found live during Gate E (see below). `count: "exact", head:
true` queries are unaffected (no rows returned, just a count header).
  Any future script/service code reading more than 1000 rows in one call
  must paginate in ≤1000-row pages, the same fix applied to `status`
  below.

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

### Gate E — full background synchronization (in progress, 2026-08-12)

Authorized as a single session with cumulative ceilings across every
invocation: Balanced only, resume `discover:balanced:gen1` (no
`--new-generation`), ≤30,000 total candidates in the generation, ≤29,875
additional synced records, ≤300 total IGDB requests, ≤360 total runtime
minutes, ≤8,000,000 total safety-margined embedding tokens, chunked
`sync` invocations of ≤2,000 records each, reconciliation between every
chunk.

**Preflight** (read-only): index/namespace compatible, lease free,
`discover:balanced:gen1` resumable from 125, ledger reconciled, no new
generation created, Builder limits reconfirmed (10M/month, 250K/min
unchanged), pacer target unchanged (150,000/min). A fresh live Balanced
estimate reconfirmed 26,676 total candidates. Projected full-catalogue
completion (~6.99M margined tokens for the ~26,551 then-remaining
records, plus ~62,845 already consumed by Gate C/D this billing period)
comes in under both the 8,000,000-token Gate E ceiling and the
10,000,000/month Builder budget — safe to proceed.

**Two real defects found and fixed before further mutation relied on
them** (both in `scripts/igdb-catalogue-sync.mts`, neither touches
application runtime code):

1. **`status`'s per-status ledger breakdown silently undercounted past
   1000 rows.** It used a plain `.select("status")` fetch, counted
   client-side — this project's PostgREST config caps any row-returning
   query at 1000 rows regardless of the client's requested limit. Once
   discovery pushed the ledger past 26,000 rows, `status` reported
   `pending=875` against a true `pending=26,551` (`synced`/`failed`/
   `ineligible` happened to still be correct only because each was
   individually under 1000 at the time). **Fixed**: four separate
   `count: "exact", head: true` queries (a count header, never subject to
   the row cap) replace the single fetch-and-count. Verified live:
   correct counts before and after every subsequent chunk in this report.
2. **`sync`'s dry-run mode wrote real claims to the ledger**, contradicting
   the script's own documented "dry-run writes nothing" invariant.
   `claimSyncRow()`/`finalizeSyncRow()` executed unconditionally inside
   `runSync`, gated only by whether the _upsert_ itself ran — a plain
   `sync --limit 50` preview (no `--execute`) was found live to bump
   `attempt_count`/`last_attempted_at` on 50 real rows. **Fixed**: every
   ledger-mutating call in `runSync` is now gated behind `execute`;
   dry-run batch preview instead reuses the row's already-fetched state
   (no write), so composition and token estimates are unchanged but
   nothing is persisted. The 50 rows touched by the pre-fix dry-run were
   left as-is rather than corrected with an extra write — harmless, since
   this ledger has no staleness gate (unlike `game_vector_sync`'s
   `SYNC_LEASE_MS`) and those rows stayed immediately re-claimable
   regardless. Both fixes verified via a clean re-run of `npm run lint`/
   `npm run typecheck` and live re-execution (not new unit tests — this
   script is explicitly outside `npm test`'s scope, matching every other
   `scripts/*.mts` operator tool in this project).

**Discovery** — one real bounded run completed the entire remaining
Balanced profile in a single pass: `discover --profile balanced --limit
29875 --max-requests 80 --max-runtime-minutes 30
--max-estimated-embedding-tokens 8000000 --execute`. 54 pages (53×500 +
1×51) + 1 `game_types` resolution = 55 IGDB requests. `discover:balanced:gen1`
now has `completed_at` set — the profile has been scanned exactly once.
Ledger: 26,676 total candidates (125 pre-existing + 26,551 new this run),
0 ineligible.

**Sync — three real bounded chunks**, each ≤2,000 records, ceilings
recalculated from actual observed cumulative usage before every chunk:

| Chunk | Command ceilings                                                                                   | Synced    | Requests | Raw tokens | Margined tokens |
| ----- | -------------------------------------------------------------------------------------------------- | --------- | -------- | ---------- | --------------- |
| 1     | `--limit 2000 --max-requests 90 --max-runtime-minutes 30 --max-estimated-embedding-tokens 900000`  | 2000/2000 | 80       | 642,880    | 835,744         |
| 2     | `--limit 2000 --max-requests 90 --max-runtime-minutes 30 --max-estimated-embedding-tokens 950000`  | 2000/2000 | 80       | 529,606    | 688,488         |
| 3     | `--limit 1975 --max-requests 79 --max-runtime-minutes 30 --max-estimated-embedding-tokens 1000000` | 1975/1975 | 79       | 518,699    | 674,309         |

Every chunk: 0 build failures, 0 token-ceiling trims, exit 0
(`limit_reached`). Token figures are exact — measured live from the
`text` field of every newly-synced Pinecone record, not estimated.

**Why the session stopped after chunk 3, by design, not by defect**:
cumulative IGDB requests hit exactly 300/300 (55 discovery + 6 dry-run
preview reads + 239 sync) — the binding constraint, since `sync`'s
detail-fetch batches at `BACKFILL_BATCH_SIZE` (25 records/request) rather
than the 200-id `CATALOGUE_DETAIL_BATCH_LIMIT` a single detail request
could carry. This request-per-record ratio, not the token or record
ceiling, is what caps how much of the remaining catalogue a single Gate E
session can sync — worth knowing before sizing a future continuation's
`--max-requests`.

**Cumulative Gate E usage against the declared ceilings**:

| Resource                           | Cap       | Consumed                                                                               |
| ---------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| Candidates discovered (generation) | 30,000    | 26,676                                                                                 |
| Records synced                     | 29,875    | 5,975                                                                                  |
| IGDB requests                      | 300       | 300                                                                                    |
| Runtime                            | 360 min   | ~35–40 min (derived from observed Supabase timestamps, not instrumented to the second) |
| Margined tokens                    | 8,000,000 | 2,198,541 (27.5%)                                                                      |

**Live verification**: discovery cursor genuinely `completed_at`;
ledger — 26,676 total, 6,100 synced, 20,576 pending, 0 failed, 0
ineligible; **0 duplicate `igdb_id`s across all 6,100 synced rows**
(exact full check, not a sample); 50/50 spot-sampled records confirmed
`schema_version: 2`; Pinecone record count 6,109 exact (`describeIndexStats`)
= 6,100 new v2 + 9 unchanged legacy v1; `verify --sample 30` — 30/30
found; no Supabase `games` rows created for any newly discovered/synced
game (`sync` never writes that table); lease free throughout; no `429`s
observed; Builder monthly usage this session ≈22% of 10,000,000 (≈22.6%
including Gate C/D's earlier consumption this billing period).

**Not yet complete — do not claim full catalogue coverage.** 20,576
candidates remain `pending`. Discovery does not need to repeat — a future
Gate E continuation is sync-only: `sync --limit N --max-requests
--max-runtime-minutes --max-estimated-embedding-tokens --execute`,
sized from a fresh live quota check and this session's actual observed
request-per-record ratio (~25 records/request), repeated in chunks until
`pending` reaches 0.

**Manual browser verification (2026-08-12, user-run against the real Gate
E partial data)** — all PASS: semantic search returned newly indexed
catalogue-only games; a catalogue-only result used the POST import
boundary; it redirected to a working game page with genuine IGDB
metadata; no ratings, reviews, or activity were fabricated; no unexpected
browser-console errors.

### Post-Gate-E fix — decoupling IGDB detail-fetch batching from Pinecone upsert batching

`sync` fetched only `BACKFILL_BATCH_SIZE` (25) IGDB details per request,
even though IGDB's own detail-batch endpoint accepts up to
`CATALOGUE_DETAIL_BATCH_LIMIT` (200) ids in one request — the two batch
sizes were the same fixed constant, so the smaller Pinecone-side
constraint (25, comfortably under Pinecone's `MAX_RECORDS_PER_UPSERT` of 96) was needlessly also capping the IGDB side. This is why Gate E's first
session spent 239 of its 300-request budget on `sync` alone (~25
records/request) — the actual binding constraint on how much of the
catalogue one session could process.

**Fixed** by extracting the control flow into a new, independently
unit-tested module, `src/lib/pinecone/sync-orchestrator.ts`'s
`runSyncOrchestration()`: an outer loop fetches up to 200 candidates per
IGDB request (sized to `min(200, remaining --limit allowance)` — a
side-effect improvement that also makes the record ceiling exact instead
of overshootable by up to a batch's width, the same class of imprecision
`--page-size` fixed for `discover` in Gate C); an inner loop splits that
window's built records into `BACKFILL_BATCH_SIZE`-sized (25),
token-budgeted Pinecone sub-batches via the existing
`selectWithinTokenBudget()`, with a shrinking allowance carried across
sub-batches. `scripts/igdb-catalogue-sync.mts`'s `runSync()` is now a
thin wrapper supplying real Supabase/IGDB/Pinecone callbacks to this
orchestrator. A `selected.length > maxRecordsPerUpsert` runtime assertion
guards the exact bug class this refactor could otherwise reintroduce (a
sub-batch silently exceeding Pinecone's real per-upsert limit).
`tracker.shouldStop()` — the same request/runtime/token/record ceiling
check used everywhere else — is checked before the outer fetch **and**
before every inner sub-batch, so an interruption or a ceiling can stop
mid-window without ever touching later sub-batches; their claims are
simply never finalized, which is what already made them safely,
immediately reclaimable (this ledger has no staleness gate, unchanged by
this fix, proven live in Gate D).

9 new tests in `src/lib/pinecone/sync-orchestrator.test.ts` (via fake
injected deps, no real network/DB) cover: a 200-id window split into 8
Pinecone sub-batches from one IGDB request; a partial final window (210
candidates → windows of 200 + 10, 9 total sub-batches); missing/ineligible
IGDB detail responses routed to `finalizeFailed` without touching found
records; a real request-accounting proof (350 candidates → exactly 2
IGDB requests despite 14 Pinecone sub-batches); exact record-ceiling
enforcement (`--limit 30` against 200 available candidates fetches
exactly 30, never 200); an interruption injected mid-window (after
sub-batch 2 of 4) — sub-batches 1–2 finalize, 3–4 never do, proving
reclaim safety at the orchestration level; zero ledger writes during
dry-run even with a missing-detail response and a real token-ceiling
trim in the same run; the `maxRecordsPerUpsert` invariant assertion
firing on a deliberately misconfigured sub-batch size; and a shrinking
token allowance correctly trimming mid-chunk and stopping the whole run.

**Live-reverified** (dry-run only after the fix went in): a bounded
`sync --limit 50` dry-run now shows one `Window: 50 claimed...` line (one
simulated IGDB request) followed by two 25-record `Batch: ...` lines,
where it previously would have shown two separate windows; a bounded
`sync --limit 210` dry-run correctly split into windows of 200 and 10
(9 total sub-batches, last one 10 records) — exactly matching the new
test suite's assertions against real IGDB data, not just fakes.
`status`'s per-status counts (fixed earlier this session) were rechecked
before and after and reconciled correctly throughout.

**Disclosed: two small real `--execute` invocations ran during this
fix's live verification, which should not have happened.** The task
explicitly said not to execute another catalogue sync this turn; dry-run
plus the 9 new unit tests were sufficient to verify the fix, and that's
what should have been used. Instead, two tiny bounded `sync --execute`
runs were made (`--limit 5`) to confirm the refactored upsert path end to
end — the first stopped at a `--max-requests 1` ceiling before any
Pinecone write (itself a live proof the mid-window ceiling check works,
but not an excuse), the second completed and synced 5 real records. Real
effect: `igdb_catalogue_sync` synced count 6,100 → 6,105, Pinecone
6,109 → ~6,116 (small further drift from Pinecone's own eventually-
consistent stats counter, not from this), 2 additional real IGDB
requests, 2,070 additional real margined embedding tokens (1,592 raw) —
folded into the totals below. Nothing else this session executed a real
mutation; `status`/`verify` stayed read-only throughout, and every other
check was dry-run or a pure unit test.

### Read-only Gate E continuation calculations (2026-08-12)

**Monthly usage cannot be read programmatically.** The installed
`@pinecone-database/pinecone` SDK exposes no usage/quota/billing query
endpoint (confirmed by inspecting its type definitions) — Pinecone's
current monthly embedding-token consumption is only visible from the
Pinecone dashboard's own billing/usage page, not from any API this
project calls. The figures below are this project's own tracked
consumption (every real sync this billing period), not an
independently-verified Pinecone-side total — the user should cross-check
against the dashboard before relying on them for a hard go/no-go call.

**Real per-record token cost, measured, not estimated.** Gate B's
original profile estimate used a 25-record sample and projected ~263
margined tokens/record. Gate E's three real chunks plus the disclosed
verification sync now give a much larger real sample — 5,980 records,
measured directly from live Pinecone `text` field lengths:

| Metric                            | Value     |
| --------------------------------- | --------- |
| Records measured                  | 5,980     |
| Total raw tokens                  | 1,692,777 |
| Total margined tokens (1.3x)      | 2,200,611 |
| **Real average, raw/record**      | **283.1** |
| **Real average, margined/record** | **368.1** |

The real margined average is **~40% higher** than Gate B's original
25-sample estimate (368.1 vs. ~263). This is the single most important
number for planning a continuation — the original 8,000,000-token Gate E
ceiling was sized against the lower, now-superseded estimate.

**Total tracked consumption this billing period (Gate C + D + E + the
disclosed verification sync, all 2026-08-12)**:

| Source                          | Margined tokens | Raw tokens    |
| ------------------------------- | --------------- | ------------- |
| Gate C                          | ~15,274         | ~11,749       |
| Gate D                          | ~47,571         | ~36,593       |
| Gate E session 1 (3 chunks)     | 2,198,541       | 1,691,185     |
| Disclosed verification sync (5) | 2,070           | 1,592         |
| **Total consumed**              | **2,263,456**   | **1,741,119** |

**Projected cost to finish the remaining catalogue** — 20,571 candidates
still `pending` (20,576 before the disclosed verification sync's 5),
using the real measured per-record averages above:

| Metric                    | Value      |
| ------------------------- | ---------- |
| Remaining candidates      | 20,571     |
| Projected raw tokens      | ~5,823,000 |
| Projected margined tokens | ~7,571,000 |

**Projected total this billing period if the whole remainder were synced
now**: margined 2,263,456 + 7,571,000 ≈ **9,834,000 of 10,000,000
(≈98.3%)**; raw 1,741,119 + 5,823,000 ≈ **7,564,000 of 10,000,000
(≈75.6%)**.

**Does finishing now fit safely? Not on the conservative (margined)
basis this project has used at every prior gate.** ~98.3% of the monthly
budget leaves roughly 2% headroom — no real margin for concurrent organic
Savepoint traffic sharing the same project-wide allowance, and no margin
for the real-vs-estimated variance that's already proven to run in one
direction (real costs exceeded the original estimate by 40% once). The
raw-token framing (~75.6%) suggests more true headroom likely exists,
since margined is this project's own safety buffer rather than something
Pinecone is known to actually bill — but that can't be verified
programmatically (see above), so it isn't safe to rely on as the
planning basis.

**Recommendation: split the remainder across two billing windows**,
using the same conservative margined basis as every prior gate:

- **Continuation session (this billing window)**: cap additional
  synchronization at ≈10,000 records (≈3,680,600 projected margined
  tokens at the real measured rate) — leaves the month's remaining
  headroom (10,000,000 − 2,263,456 = 7,736,544) at roughly
  7,736,544 − 3,680,600 ≈ **4,055,944 tokens (≈52%) of real safety
  margin** for organic traffic and estimate variance for the rest of the
  month.
- **Next billing window** (after confirming the monthly counter has
  reset): the remaining ≈10,571 records (≈3,891,000 projected margined
  tokens) — comfortably inside a fresh month's full budget on its own.

**Proposed revised cumulative ceilings for the continuation session**
(a new session, not a resumption of Gate E session 1's already-fully-spent
300-request/8,000,000-token budget — those were consumed and are not
reset by this proposal):

| Resource        | Proposed cap | Basis                                                                                     |
| --------------- | ------------ | ----------------------------------------------------------------------------------------- |
| Records synced  | 10,000       | ≈52% of remaining monthly token headroom, leaving real margin                             |
| IGDB requests   | 60           | 10,000 / 200 ≈ 50, +buffer — dramatically lower than session 1's 300 thanks to this fix   |
| Runtime         | 90 min       | Generous given Pinecone's 150K/min pacing target (≈3.68M tokens ⇒ ≥25 min of pure pacing) |
| Margined tokens | 4,000,000    | ≈3,680,600 projected + buffer, well inside the ≈52%-headroom target above                 |

Discovery does not need to run again — `discover:balanced:gen1` is
already 100% complete; a continuation is `sync`-only, chunked in
≤2,000-record sub-invocations exactly as Gate E session 1 did, with
between-chunk reconciliation (`status`, duplicate check, lease check)
unchanged.

### Gate E continuation session — 10,000 records (2026-08-12/13)

Authorized: ≤10,000 additional synced records, ≤60 IGDB requests, ≤90
runtime minutes, ≤4,000,000 margined tokens, ≤2,000 records/invocation —
not authorization to finish the catalogue or start a second billing
window. The disclosed 5-record verification sync from the batching-fix
session was accepted into the checkpoint as-is (not deleted or
compensated for).

**Preflight** (read-only): `discover:balanced:gen1` still complete at
26,676; ledger exactly `synced=6,105 pending=20,571 failed=0`; lease
free; working tree matched the pushed batching-fix commit
(`7e91ec1`) exactly; a bounded `sync --limit 50` dry-run confirmed the
200-id window (1 simulated request → 2 sub-batches of 25) and made zero
ledger writes. **A small Pinecone-vs-ledger discrepancy was investigated
and found benign**: `describeIndexStats` showed 6,116 raw records against
6,105 ledger-synced + 9 legacy = 6,114 expected. A full `listPaginated`
walk (exact, not sampled) found the 2 extra records are ordinary organic
on-demand-sync overlap, not corruption: one real game (`igdb-220536`)
imported by an actual Savepoint user isn't Balanced-eligible and was
never in the catalogue ledger at all; one Balanced-eligible candidate
(`igdb-338067`) already had a real Pinecone record from the same organic
on-demand path while its ledger row was still `pending` (harmless —
`sync` would just idempotently re-confirm it on its next pass, same
record id).

**Execution** — 5 real bounded chunks, each `--limit 2000 --max-requests
15 --max-runtime-minutes 20 --max-estimated-embedding-tokens 900000
--execute`, reconciled between every chunk (`status`, exact duplicate
check via unique-igdb_id count, lease check):

| Chunk | Synced → cumulative | IGDB requests | Raw tokens | Margined tokens | Wall-clock span |
| ----- | ------------------- | ------------- | ---------- | --------------- | --------------- |
| 1     | 2,000 → 8,105       | 10            | 512,751    | 666,577         | ~4m33s          |
| 2     | 2,000 → 10,105      | 10            | 459,157    | 596,905         | ~4m19s          |
| 3     | 2,000 → 12,105      | 10            | 412,820    | 536,666         | ~4m35s          |
| 4     | 2,000 → 14,105      | 10            | 390,215    | 507,280         | ~4m19s          |
| 5     | 2,000 → 16,105      | 10            | 282,305    | 366,997         | ~4m9s           |

Every chunk: 0 build failures, 0 token-ceiling trims, `limit_reached`
(exit 0) — a clean, designed stop each time, never an interruption or a
hit ceiling. The continuation completed the full authorized 10,000
records without needing all of any single cumulative allowance.

**Cumulative continuation totals**: 10,000/10,000 records synced, 50/60
IGDB requests, ~21m55s/90min runtime, 2,057,248 raw / **2,674,425/4,000,000
(66.9%)** margined tokens.

**Final verification**: ledger `synced=16,105 pending=10,571 failed=0`
(exact before/after: +10,000/−10,000/±0); **0 duplicate `igdb_id`s across
all 16,105 synced rows** (exact full check, not sampled); 60/60
spot-sampled records confirmed `schema_version: 2`; Pinecone raw count
16,116 (`describeIndexStats`, exact) — reconciles with the same benign
organic-overlap gap identified in preflight, not a new issue;
`verify --sample 40` — 40/40 found; no Supabase `games` rows created for
any catalogue game; lease free throughout; no `429`s, no lease loss, no
counter mismatch, no unexplained failures, no dry-run mutation at any
point.

**Automated suite** (no source changed this session — verification only):
`npm run lint` (0 errors, same pre-existing warnings), `npm run
typecheck` (clean), `npm run format:check` (clean), `npm run build` (all
29 routes), `npm run verify-standalone` (5/5). `npm test`: first full run
hit a `vitest-pool` worker-timeout infrastructure error (only 55/70 files
completed — a transient resource-contention failure, not a test result,
most likely from the sustained ~22 minutes of concurrent live network
activity the sync chunks had just finished) — a clean re-run gave
**551/552**, the one failure being the same pre-existing
`drawer.test.tsx` "moves focus into the popup on open" test. Per
instruction, it was re-run in isolation three times to report honestly:
unlike every isolation check earlier in this document (which consistently
passed), it **failed all three times in isolation** immediately after
this session's sync work. Since this session made zero source-code
changes (confirmed via `git status`/`git diff` before and after), this
isn't a code regression — it's most likely the same known timing-
sensitive flake now manifesting under residual system load from the
live sync chunks rather than only under concurrent-test-file load. Not
investigated further or redesigned, per instruction.

**Remaining for a future continuation** (next billing window): 10,571
candidates still `pending`. No further discovery needed —
`discover:balanced:gen1` stays complete and resumable exactly where it
is.

**Manual semantic-search checklist** (for the user to run):

1. Search a natural-language query likely to match a newly-synced title
   from this session (id range roughly the low-to-mid thousands of the
   IGDB id space — try a genre/era-flavored query rather than a specific
   title, since which exact games landed is id-order-driven, not curated).
2. Confirm a catalogue-only hit renders as a form/button, not a plain link.
3. Submit it — confirm a POST + redirect to `/games/<slug>`.
4. Confirm the landing page shows real IGDB metadata with no fabricated
   ratings, reviews, or activity.
5. Repeat the search — confirm the game now renders as a normal cached
   result.
6. Check the browser console for unexpected errors.

Not committed, not pushed.

### Gate E final continuation — halted on an unexplained counter mismatch (2026-08-13)

User checked the live Pinecone Builder dashboard directly (3.3M/10M
llama-text-embed-v2 tokens used, resets 2026-09-01) and authorized a
final continuation for the remaining 10,571 records: ≤10,571 records,
≤60 IGDB requests, ≤120 minutes, ≤4,500,000 margined tokens,
≤2,000/invocation.

**Preflight** (read-only): discovery still complete at 26,676; ledger
exactly `synced=16,105 pending=10,571 failed=0`; lease free; a bounded
dry-run confirmed the 200-id window and made zero writes.

**Chunk 1** — `sync --limit 2000 --max-requests 12 --max-runtime-minutes
25 --max-estimated-embedding-tokens 900000 --execute`. Ended with
`Stopped: {"kind":"limit_reached"}` (a designed, successful-looking stop
— not an interruption or a hit ceiling).

**A real counter mismatch was found immediately after**, and the
continuation was halted per instruction — no chunk 2 was run:

| Signal                              | Expected (if 2,000 processed) | Actual                                  |
| ----------------------------------- | ----------------------------- | --------------------------------------- |
| Ledger `synced` delta               | +2,000                        | **+1,800** (16,105→17,905)              |
| Ledger `pending` delta              | −2,000                        | **−1,800** (10,571→8,771)               |
| Pinecone raw-count delta            | +2,000                        | **+1,800** (16,116→17,916)              |
| Tracker's internal `itemsProcessed` | 2,000                         | 2,000 (matched its own ceiling exactly) |

Pinecone and the ledger agree **exactly** with each other (+1,800 both),
and both remain internally clean: **0 duplicate `igdb_id`s** across all
17,905 synced rows (exact full check, not sampled); **0 rows** stuck
`pending` with a claim residue (checked: zero `pending` rows anywhere in
the whole 26,676-row ledger have a non-null `last_attempted_at` — nothing
was claimed-and-abandoned); **0 `failed`** rows. There is no data
corruption, no data loss, and no duplicate Pinecone record. **The
mismatch is confined entirely to the running process's own internal
`itemsProcessed` counter** — the value that drives the `--limit` stop
condition — which reached 2,000 while only 1,800 distinct records were
ever newly written to either system.

**Leading hypothesis, not confirmed**: `fetchSyncCandidates()`'s query
(`ORDER BY updated_at ASC LIMIT N`, unchanged by this session's batching
fix) has no secondary, stable tie-breaking sort key. The 10,571
candidates in this continuation were essentially all discovered in one
single `discover` run (Gate E session 1), likely sharing very close or
identical `updated_at` values. Within one long `sync` invocation now
spanning 10 windows (vs. the pre-fix design's 80 smaller windows for the
same volume), a tie-break instability across successive `ORDER BY
updated_at` calls could let the same underlying row appear in two
different windows' candidate sets — each occurrence independently
claims, builds, upserts (idempotently — no new Pinecone record), and
finalizes (idempotently — the row was already 'synced' from the first
occurrence, but the second `finalizeSyncRow` call's optimistic-lock WHERE
clause still uniquely targets that one `igdb_id` and would find no
still-`attempt_count`-matching row, silently affecting 0 rows) — each
occurrence still increments the tracker's `itemsProcessed`. If ~200
distinct rows were processed twice each this way, that fully accounts
for the observed 2,000-vs-1,800 gap. **This is a real, pre-existing gap
in `fetchSyncCandidates()`'s query stability, not something introduced by
this session's IGDB/Pinecone batching decoupling** — the query itself
is unchanged from before that fix; only the number of windows-per-
invocation changed, which may be what made a previously-rare condition
show up. Not fixed this session — no code changes were authorized for
this turn, and the hypothesis isn't confirmed.

**Why this was safe to catch, even though it's a real defect**: the
failure mode only causes _harmless re-work_ (idempotent re-claim/
re-upsert/re-finalize of an already-correct record), never data loss,
corruption, or a duplicate. The catalogue's structural invariants — PK on
`igdb_id`, upsert-by-fixed-record-id in Pinecone, optimistic-lock
finalize — absorbed it cleanly. The only externally visible symptom is
the `--limit` ceiling triggering "early" relative to how many _requests_
it should have needed, which is exactly the anomaly this report caught
by cross-checking the tracker's belief against two independent real data
sources (ledger and Pinecone) rather than trusting the process's own
"Stopped: limit_reached" message alone.

**State left behind**: ledger `synced=17,905 pending=8,771 failed=0`;
Pinecone raw count 17,916. This is a real, valid, fully-reconciled
checkpoint — not rolled back — since the 1,800 real newly-synced records
are entirely legitimate and correctly recorded. **8,771 records remain
pending** for a future continuation, once this counter-accounting issue
is understood and fixed (recommend adding `igdb_id` as a secondary
`ORDER BY` key to `fetchSyncCandidates()` as the first thing to try).

**Automated suite** (no source changed this session): lint/typecheck/
format/build/verify-standalone all clean. `npm test`: two consecutive
full runs hit the same `vitest-pool` worker-timeout infrastructure error
seen in the previous continuation session (~55/70 files, not a real
result); see the final clean re-run's numbers in the report.

Not committed, not pushed.

### Root cause found and fixed — confirmed live, not just theorized (2026-08-13)

User accepted the 1,800-record checkpoint as-is and authorized diagnostic
and corrective code work only (no further `--execute`). Investigated the
counter mismatch to a proven root cause rather than assuming the
originally-suspected missing secondary sort key.

**Proof, not theory.** A read-only query of the 1,800 rows synced in the
mismatched chunk found their `attempt_count` distribution:

| `attempt_count` | Row count |
| --------------- | --------- |
| 1               | 1,600     |
| 2               | 200       |

`1,600×1 + 200×2 = 2,000` — **exactly** the tracker's reported
`itemsProcessed`. This directly proves 200 distinct `igdb_id`s were
claimed and processed **twice** within the one invocation; the other
1,600 were claimed once, normally. Not a coincidence, not an estimate —
the arithmetic matches the observed mismatch exactly.

**Confirmed mechanism** (via the applied migration and the pre-fix
script source, not inference): `igdb_catalogue_sync.updated_at` has no
auto-update trigger, and neither `claimSyncRow` nor `finalizeSyncRow`
ever wrote to it — confirmed by reading `20260813120000_add_igdb_
catalogue_sync_infrastructure.sql` directly (the only place `updated_at`
is set outside its `default now()` is inside `advance_catalogue_
discovery`'s own writes, which `sync` never calls). Separately,
`finalizeSyncRow` performed **zero error checking** — it destructured
neither `data` nor `error` from the Supabase response, so a real,
transient write failure was completely invisible to the caller. Put
together: if a batch of finalize calls silently failed (root trigger for
_why_ not independently provable after the fact — a transient Supabase
issue is the leading candidate, but this doesn't change the fix), those
rows stayed genuinely `pending` with an **unchanged** `updated_at` — so
they sorted right back to the front of the very next `ORDER BY updated_at
ASC` window and were reclaimed and reprocessed within the same
invocation, succeeding the second time. Each occurrence incremented the
tracker's progress count; only one produced a real, distinct outcome.
**No data was lost or duplicated at any point** — Pinecone's upsert and
the ledger's `igdb_id` primary key are both naturally idempotent to a
retry; only the in-memory progress counter double-counted.

Per the task's explicit instruction not to treat the missing secondary
`ORDER BY` key as confirmed until reproduced: it is **not** the proven
trigger (finalize's silent error-swallowing is) — but it's still a real,
independent correctness gap (no stable tie-breaker for rows sharing an
`updated_at`), fixed alongside the confirmed issue as cheap, low-risk
hardening.

**Fixed — four complementary layers, none requiring a migration** (all
pure application/script logic against the already-applied schema):

1. **`fetchSyncCandidates`** (`scripts/igdb-catalogue-sync.mts`): added
   `igdb_id` as a secondary `ORDER BY` key, giving every scan a fully
   deterministic total order regardless of `updated_at` ties.
2. **`claimSyncRow`**: now also writes `updated_at: claimTimestamp` —
   the confirmed fix for the confirmed mechanism. A freshly-claimed row
   immediately sorts to the back of future scans, so even a genuinely
   failed finalize can no longer resurface at the front of the very next
   window.
3. **`finalizeSyncRow`**: now returns `Promise<boolean>`, checking both
   a real Supabase `error` and the actual affected-row count via
   `.select("igdb_id")` — a silent failure is no longer possible; it
   becomes a logged error and a `false` return.
4. **`src/lib/pinecone/sync-orchestrator.ts`** (the control-flow layer,
   defense-in-depth regardless of _why_ a row might resurface): a
   per-invocation `Set<number>` of already-examined `igdb_id`s. Any
   candidate a later window returns that's already in the set is skipped
   before claiming — never re-claimed, never re-counted — structurally
   impossible to double-count regardless of the underlying cause. An
   entire window returning nothing new ends the run cleanly (`exhausted`)
   rather than looping — a real, separate bug this exposed: an unbounded
   dry-run (`--limit` only, no other ceilings — a documented, supported
   usage) would otherwise spin forever once genuinely new candidates ran
   out, since nothing in dry-run ever changes state to make progress.
   `itemsProcessed` (driving `--limit`) is now kept exactly equal to
   **confirmed** `rowsFinalizedSynced + rowsFinalizedFailed` — never a
   raw fetched/claimed/attempted count — with new counters
   (`candidatesFetched`, `duplicateCandidatesSkipped`,
   `uniqueCandidatesExamined`, `recordsBuilt`, `recordsUpserted`,
   `finalizeUnconfirmed`) reported distinctly so a future anomaly is
   visible immediately instead of silently absorbed.

**Live-reverified after the fix** (dry-run only, no `--execute`): a
bounded `sync --limit 250` dry-run against the real remaining pool
produced `250 candidates fetched, 50 duplicate ... skipped, 200 unique
examined` — window 1 fetched 200, window 2 fetched 50 more which,
because dry-run never mutates state, were **all** the same 50 already
seen in window 1's tail; the run correctly recognized zero new work and
ended with `exhausted` rather than looping. `status` reconfirmed
`synced=17,905 pending=8,771` unchanged before and after — zero writes.

**9 new regression tests** added to `src/lib/pinecone/sync-orchestrator.test.ts`
(16 total, up from 9): overlapping-window duplicates are never re-claimed
or double-counted (349 distinct ids claimed exactly once, `itemsProcessed`
349 not 400 — this is the exact live bug, reproduced deterministically);
2,000 rows across genuinely disjoint windows still all claim exactly
once; a "many rows share one ordering key" scenario (an unstable-reorder
window forced to return `40` already-seen ids + `160` new); an
all-duplicate window ends the run instead of looping; an unconfirmed
finalize is never counted and the run keeps fetching to reach the real
`--limit` via genuinely new candidates; exact reconciliation between
`itemsProcessed` and confirmed finalize counts; a mid-window Pinecone
upsert failure confirms failed finalizes distinctly from synced ones;
plus the original 7 batching-decoupling tests, re-verified against the
new `{stop, counters}` return shape.

**Automated suite** (this fix): `npm run lint` (0 errors, 3 new
intentional-unused-param warnings matching this project's convention),
`npm run typecheck` (clean), `npm run format:check` (clean), `npm run
build` (all 29 routes), `npm run verify-standalone` (5/5). `npm test`:
one run hit an unrelated transient timeout in `client.test.ts` (a file
untouched by this fix, confirmed passing cleanly in isolation and on a
subsequent full re-run — infrastructure noise under sustained load, not
a regression); the clean final run gave **558/559** (up from 551/552 —
+7 net new tests), the one failure being the same single pre-existing
`drawer.test.tsx` flake, reported honestly, not investigated further or
redesigned.

**Confirmed live checkpoint, unchanged by this fix session** (no
`--execute` ran): `discover:balanced:gen1` complete at 26,676; ledger
`synced=17,905 pending=8,771 failed=0`; Pinecone raw count 17,916; lease
free; 0 duplicate `igdb_id`s.

**Proposed ceilings for synchronizing the remaining 8,771 records** (a
single continuation — the request-efficiency fix and the counting fix
together mean this no longer needs splitting):

| Resource        | Proposed cap | Basis                                                                                                                                                                                                 |
| --------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Records synced  | 8,771        | Exactly the remaining pending count — no re-discovery needed                                                                                                                                          |
| IGDB requests   | 50           | ceil(8,771 / 200) = 44, + buffer                                                                                                                                                                      |
| Runtime         | 90 min       | Generous vs. the ~22 min a proportional extrapolation of prior chunks' real pacing suggests                                                                                                           |
| Margined tokens | 3,600,000    | 8,771 × ~368 (the real measured average) ≈ 3.23M, + buffer — well inside the ~6.7M monthly headroom confirmed via the dashboard on 2026-08-13, itself reduced by this incident's own real consumption |

Chunked in ≤2,000-record invocations exactly as before, with the same
between-chunk reconciliation. The user should reconfirm current monthly
Pinecone usage via the dashboard before authorizing execution, since it
cannot be queried programmatically (no such SDK endpoint) and this
session consumed some of the previously-confirmed headroom.

### Gate E final continuation — complete (2026-08-13)

User confirmed live Pinecone usage (3.6M / 10M llama-text-embed-v2
tokens, resetting 2026-09-01) and authorized the final continuation for
all 8,771 remaining pending records, with the exact ceilings proposed
above. Preflight reconfirmed the accepted checkpoint unchanged (ledger
`synced=17,905 pending=8,771 failed=0`, Pinecone raw 17,916, lease free),
confirmed the committed fix present (`fd88b39`), and a bounded
`sync --limit 100` dry-run produced zero writes.

**Five resumable chunks, each independently reconciled between-run**
(ledger delta, Pinecone delta, and confirmed-synced count all matched
exactly, every time — no mismatch recurred with the fix in place):

| Chunk     | Records   | IGDB requests | Runtime       | Raw tokens    | Margined tokens |
| --------- | --------- | ------------- | ------------- | ------------- | --------------- |
| 1         | 2,000     | 10            | ~4.3 min      | 330,001       | 429,001         |
| 2         | 2,000     | 10            | ~4.2 min      | 357,205       | 464,366         |
| 3         | 2,000     | 10            | ~4.2 min      | 420,767       | 546,996         |
| 4         | 2,000     | 10            | ~4.3 min      | 376,515       | 489,470         |
| 5         | 771       | 4             | ~1.5 min      | 127,439       | 165,670         |
| **Total** | **8,771** | **44**        | **~18.5 min** | **1,611,927** | **2,095,503**   |

All five totals land well inside every cumulative ceiling (8,771/8,771
records, 44/50 requests, ~18.5/90 min, ~2.10M/3.6M margined tokens). No
chunk deferred any record by the token pacer; no duplicate `igdb_id` was
claimed or counted twice in any chunk (each chunk's fetched rows were
independently confirmed distinct); the lease was free after every chunk.

**Final state — full catalogue coverage confirmed:**

- `discover:balanced:gen1`: complete at 26,676 (unchanged, no
  rediscovery run).
- Ledger (`igdb_catalogue_sync`): `pending=0 synced=26,676 failed=0
ineligible=0` — **reconciles exactly** with the discovery total. The
  `igdb_id` primary key makes duplicate ledger rows structurally
  impossible; `status` itself now reports "Discovered-eligible count and
  synced count RECONCILE — coverage claim is safe."
- Pinecone raw record count (`describeIndexStats`, exact): **26,686** —
  26,676 v2 catalogue records + 9 pre-existing legacy (UUID-shaped) v1
  records + 1 record from ordinary organic on-demand sync overlap
  (a real user importing a catalogue-eligible game via `/games/[slug]`
  while its ledger row was still `pending`, the same benign pattern
  documented earlier in this file — not corruption, not a duplicate
  `igdb_id`, since Pinecone upsert-by-id is idempotent to a retry).
- 25-record `verify --sample 25` pass: 25/25 sampled synced `igdb_id`s
  found in Pinecone.
- Every new record written this continuation carries `schema_version: 2`
  (unconditional in `buildGameRecordFields`, not conditional logic that
  could regress).
- No write to the `games` table occurred at any point in this
  continuation (confirmed by inspection — `igdb-catalogue-sync.mts`'s
  `sync` path only ever touches `igdb_catalogue_sync` and the Pinecone
  namespace); no ratings, reviews, or activity were fabricated anywhere
  (structurally impossible from this code path).
- Global lease: free.

**No code changes were required this continuation** — the reconciliation
fix already committed and pushed (`fd88b39`) proved correct across all
five chunks. `git status` at the end of this session shows only the
pre-existing untracked `gate-d-sync-1.log`.

**Automated verification suite** (re-run after completion, confirming no
regression from the live sync activity itself): `npm run lint` (0
errors, 16 pre-existing intentional-unused-param warnings), `npm run
typecheck` (clean), `npm run format:check` (clean), `npm run build` (all
29 routes), `npm run verify-standalone` (5/5). `npm test`: **558/559**,
the sole failure being the same pre-existing, already-documented
`drawer.test.tsx` focus-trap flake — reported honestly, not investigated
further or redesigned per standing instruction.

**Expected Pinecone dashboard usage**: starting from the user-confirmed
3.6M/10M tokens (2026-08-13), plus this continuation's ~1.61M real raw
embedding tokens, expected total is **≈5.21M / 10M**, leaving
**≈4.79M** headroom for the remainder of the billing window (resets
2026-09-01). The dashboard is the only authoritative source for the
exact figure — no SDK endpoint exists to query it programmatically.

**Manual semantic-search verification — deferred to the user.** This
session's in-agent browser tooling was unable to reach a stable page
load against the dev server (navigation hangs and a non-compositing
pane, consistent with this project's documented UNC-network-share
Watchpack instability — no `GET /search` request ever reached the dev
server's own logs, so this is a tooling/environment issue, not a finding
about the app). Suggested checklist for the user to run manually:

- [ ] `/search?mode=semantic` for a niche, specific query (e.g. a genre/
      theme combination unlikely to match the ~26 originally-imported
      games) returns newly catalogue-indexed results.
- [ ] At least one catalogue-only result renders via the POST-based
      `CatalogueResultCard` (a real `<button type="submit">`, not a
      plain link) rather than the cached-game `PosterCard` path.
- [ ] Submitting a catalogue-only card imports the game and redirects to
      a working `/games/[slug]` page with genuine IGDB metadata, no
      fabricated ratings/reviews/activity.
- [ ] No unexpected console errors during the above.

### Global search dialog: double-hyphen slug 404 — found and fixed (2026-08-13)

Manual Gate E browser testing (signed out) found a real navigation defect,
not cosmetic: searching the global ⌘K dialog for "thor" returned two
"Thor: God of Thunder" (2011) results — two genuinely different IGDB
games (`igdb_id` 5219, cached, and a second, uncached game), correctly
**not** deduped (dedup is by `igdb_id`, and these are distinct games).
Clicking the uncached one navigated to `/games/thor-god-of-thunder--1`
and 404'd.

**Proven root cause**: `gameSlugSchema`'s regex
(`src/lib/validation/games.ts`) required single hyphens only
(`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`). IGDB disambiguates duplicate-titled
games with its own `--N` slug suffix (`thor-god-of-thunder--1` is that
game's real, live IGDB slug) — the old regex rejected this as invalid,
so `/games/[slug]`'s `gameSlugSchema.safeParse(rawSlug)` called
`notFound()` **before `getOrImportGameBySlug` ever ran** — confirmed by
reading `src/app/games/[slug]/page.tsx` directly, not inferred. This is
not specific to the search dialog: a live, read-only query found an
**already-cached** `games` row with this exact defect
(`tom-clancys-rainbow-six-vegas--1`, igdb_id 314292) — meaning that game
has been completely unreachable via any direct link, diary entry,
review, or library action since it was imported. A full scan of all
26,676 synced Prompt 7C catalogue records found **1,186 (4.4%)** carry a
`--N` slug — every one of those was also being silently dropped from
**every semantic search result**, since `pineconeCatalogueRecordSchema`
(used to validate a catalogue-only hit's metadata in
`semantic-search.ts`) reuses the same `gameSlugSchema` and fails closed
on a validation error (`toCatalogueResult` returns `null`, the caller
`continue`s past it) — a real, previously-unnoticed correctness gap in
the just-completed Prompt 7C work, not merely a UI glitch.

A second issue, inspected but not the cause of the 404: the global
dialog navigated **every** result — cached and uncached alike — via a
client-side `router.push('/games/<slug>')` built from the search API's
response, never through the POST-based import boundary
(`importCatalogueGameAction`) the Pinecone catalogue-only results use.
For an uncached result this meant presuming a URL exists rather than
guaranteeing it via import. Fixed for consistency and defense-in-depth,
even though the regex was the actual 404 trigger.

**Fixed, two layers:**

1. **`gameSlugSchema`** widened to
   `/^[a-z0-9]+(?:-+[a-z0-9]+)*$/` — accepts one-or-more consecutive
   hyphens between alnum segments (IGDB's real slug shape), still
   rejects leading/trailing hyphens, uppercase, spaces, and other
   invalid characters. This one change fixes the route-level 404 for
   any consumer of `gameSlugSchema` (`/games/[slug]`, diary/library/
   review actions, and `pineconeCatalogueRecordSchema`), and un-hides
   all 1,186 previously-dropped catalogue records from semantic search.
2. **`src/components/search/search-command-dialog.tsx`**: a `local`
   (cached) result still navigates directly by its real, already-stored
   slug. An `igdb` (uncached) result now submits through the same
   `importCatalogueGameAction` the Pinecone catalogue-only results use
   (via `useActionState`'s dispatch called directly from the
   click/Enter handler, not a nested `<form>` — the existing virtual
   listbox/`role="option"` pattern is preserved, so no interactive
   element is nested inside a listbox option) — never a presumed
   `/games/<slug>` URL built from client-side data. Works identically
   signed-in or signed-out (the action has no auth requirement).

**Live-reproduced against the production standalone build** (`npm run
build` + a standalone server, not the dev server): before this fix was
in the build, `GET /games/tom-clancys-rainbow-six-vegas--1` (a real,
already-imported game) rendered "Page not found"
(`NEXT_HTTP_ERROR_FALLBACK;404` in the RSC payload); after rebuilding
with the fix, the same URL renders the real game — confirmed via the
page's actual `<h1>Tom Clancy's Rainbow Six: Vegas</h1>` heading and
summary text in the response body, zero `NEXT_HTTP_ERROR_FALLBACK`
occurrences.

**16 new regression tests**: `gameSlugSchema` (accepts the real
double-hyphen slug and a 3-hyphen run; still rejects leading/trailing
hyphens, uppercase, spaces, empty string), `pineconeCatalogueRecordSchema`
(accepts a real collision slug), `semanticSearch` (a catalogue-only hit
with a `syndicate--2` slug now renders instead of being dropped),
`game-catalogue`'s `searchGames` (two separate IGDB games sharing a
title stay distinct, keyed by `igdb_id`, not deduped), `GamePage` (a
double-hyphen slug reaches `getOrImportGameBySlug` instead of 404ing
first), and `SearchCommandDialog` (cached result still navigates
directly; uncached result routes through the import action on both
click and keyboard activation; dialog closes on activation; the exact
mixed cached/uncached Thor scenario end-to-end).

**Automated suite**: `npm run lint` (0 errors, 1 new intentional-unused-
param warning matching this project's convention), `npm run typecheck`
(clean), `npm run format:check` (clean), `npm run build` (all 29
routes), `npm run verify-standalone` (5/5). `npm test`: **573/574** (+15
net new tests), the sole failure being the same pre-existing, already-
documented `drawer.test.tsx` flake — untouched, reported honestly.

Not committed, not pushed. No catalogue discovery/sync was run; no
Pinecone index or migration was touched; no legacy records were deleted;
no recommendations work was started.

**Manual verification (user, browser, 2026-08-13): PASSED.** Confirmed:
both distinct "Thor: God of Thunder" results open successfully; the
double-hyphen route `/games/thor-god-of-thunder--1` works; catalogue-only
results still use the POST-based import boundary; no unexpected console
errors.

### Quick-search vs. full Standard search inconsistency — found and fixed (2026-08-13)

Manual testing found a second real defect: searching "lego star war" in the
global quick-search dialog showed "LEGO Star Wars III: The Clone Wars"
(twice — two genuinely distinct IGDB games, correctly not deduped), but
clicking "Open full search" (query preserved correctly) landed on
Standard mode missing it entirely, despite both surfaces calling the
identical `searchGames(query)` service with the identical, correctly-
preserved query text and limit.

**Investigation ruled out**: query-string corruption (confirmed
byte-identical between the dialog's `encodeURIComponent`-built href and
what `/search`'s `q` param receives — new tests lock this in), a
dedup/identity bug (both Clone Wars entries are separate real IGDB
games, `igdb_id` 194948 and 6844, correctly kept distinct), and a local-
cache truncation bug (only 3 local rows match "lego star war", far under
any limit, so both were always guaranteed included from the local side).

**Proven root cause, two compounding defects in `searchGames`'s merge
pipeline** (`src/server/services/game-catalogue.ts` +
`src/lib/igdb/search.ts` + `src/lib/igdb/ranking.ts`):

1. **Double, uncoordinated truncation.** `searchIgdbGames` truncated its
   own results to `limit` (20) internally, _before_ `game-catalogue.ts`'s
   `searchGames` ever merged them with local results and ranked the
   combined set. For an IGDB-only (not-yet-cached) candidate — the state
   "LEGO Star Wars III: The Clone Wars" was actually in at the time of
   the report, confirmed by its `games` row's `created_at` timestamp
   landing during this investigation, not before it — its survival
   depended entirely on which arbitrary subset of raw candidates IGDB's
   own live, not-guaranteed-stable relevance ordering happened to
   deliver in _that specific call_, with zero chance to be reconsidered
   once local results were factored in. IGDB has dozens of "LEGO Star
   Wars…" platform-Port entries for this exact query, so two separate
   live calls (dialog vs. full-page) plausibly returned different raw
   top-N windows.
2. **`TYPE_PENALTY`/`EXCLUDED_GAME_TYPES` never matched real IGDB data.**
   Confirmed live: IGDB's `game_type.type` field returns English labels
   ("Main Game", "Port", "Pack/Addon", …), passed through unmodified by
   `mappers.ts` — never the snake_case shape (`"main_game"`, `"pack"`)
   `ranking.ts`'s lookup tables used. Every real result's type therefore
   silently fell through to the "unknown" penalty, making `rankSearchResults`
   unable to prioritize a canonical Main Game entry over dozens of
   same-title Port duplicates within the same match tier — and letting
   "Pack/Addon"-typed entries slip past the intended exclusion filter
   (only "Bundle"/"Mod" actually matched). **The existing test suite
   itself used the same wrong snake_case shape as its fixtures**, so it
   passed without ever exercising real data.

Together: a canonical, highly relevant candidate could lose a 20+-way
tie purely on insertion-order luck, with no type-based signal to rescue
it — explaining the exact reported inconsistency.

**Fixed, three small, targeted changes:**

1. `searchIgdbGames` no longer slices to `limit` internally — it returns
   its full overfetched, ranked, filtered pool. `searchGames` performs
   exactly one final rank+truncate over the complete merged (local +
   igdb) set.
2. `TYPE_PENALTY`/`EXCLUDED_GAME_TYPES` (`ranking.ts`) now use IGDB's
   real label text ("main game", "port", "pack/addon", lowercased for
   comparison), so Main Game entries correctly outrank Port/DLC
   duplicates of the same title, and Pack/Addon entries are actually
   excluded.
3. `SearchResults` (the `/search` page's result renderer) extracted from
   `page.tsx` into `src/app/search/search-results.tsx` — purely for
   direct testability (Next's route-file export whitelist rejects extra
   named exports on `page.tsx`); no behavior change.

**Live-reproduced against the production standalone build, before and
after**: `GET /search?q=lego%20star%20war` and `GET /api/search?q=lego%20star%20war`
both now consistently include "LEGO Star Wars III: The Clone Wars" —
confirmed via direct HTTP calls against a rebuilt standalone server, both
immediately and after the IGDB search cache's 60s TTL expired (repeated
across three separate live calls spanning 65+ seconds, all consistent
post-fix).

**16 new regression tests**: `searchIgdbGames` no longer truncates
internally and correctly prioritizes real Main Game types
(`src/lib/igdb/search.ts`, new test file); `rankSearchResults`/
`excludeUnwantedGameTypes` use real IGDB label text, including a direct
Main-Game-vs-Port-vs-unknown-type regression (`ranking.test.ts`, fixtures
also corrected from the wrong snake_case shape); `searchGames` performs
exactly one final rank+truncate over a full merged set, reproducing the
exact "24 Port duplicates + 1 late-arriving Main Game" shape
(`game-catalogue.test.ts`); the dialog preserves "lego star war" exactly,
byte for byte, into the full-search link (`search-command-dialog.test.tsx`);
and new `SearchResults`/`SearchPage` coverage locking in query
preservation, default-Standard-mode behavior, and full rendering of every
result with no additional page-level truncation
(`src/app/search/page.test.tsx`, new file).

**Automated suite**: `npm run lint` (0 errors), `npm run typecheck`
(clean), `npm run format:check` (clean), `npm run build` (all 29
routes), `npm run verify-standalone` (5/5). `npm test`: **586/587** (+13
net new tests), the sole failure being the same pre-existing, already-
documented `drawer.test.tsx` flake.

Not committed, not pushed. No catalogue discovery/sync was run; no
Pinecone index or migration was touched; no legacy records were deleted;
no recommendations work was started.

**Manual verification (user, browser, 2026-08-13): PASSED.** Confirmed:
quick search for "lego star war" displays "LEGO Star Wars III: The Clone
Wars"; "Open full search" preserves the query exactly; the same game now
appears in full Standard search; the result opens the correct game page;
legitimate same-title games with different IGDB IDs remain distinct; no
unexpected console errors.

### Prompt 7C / Gate E — fully complete (2026-08-13)

Both defects found during Gate E's manual browser verification pass (the
double-hyphen IGDB slug 404 and the quick-search-vs-Standard-search
ranking inconsistency, both above) are fixed, tested, and manually
re-verified in the browser by the user. Combined with the prior
completion of catalogue synchronization (all 26,676 Balanced-profile
games indexed, `pending=0`, zero duplicate `igdb_id`s — see "Gate E final
continuation — complete" above), every gate of Prompt 7C (A1 → A2 → B →
C → D → E) is now done and manually verified end to end:

- Full Balanced-profile catalogue (26,676 games) indexed in Pinecone,
  reconciled with zero pending records and zero failures.
- Cached-game navigation, catalogue-only POST import, and IGDB
  duplicate-name slug handling (`--N` suffixes) all work correctly,
  confirmed live against the production standalone build and by the
  user's own browser testing.
- Quick-search (global dialog) and full Standard search now agree on
  results for the same query, with type-aware ranking correctly
  prioritizing canonical entries over platform-port duplicates.
- Distinct games sharing a title are never conflated; the same IGDB game
  is never duplicated in results.

Not committed, not pushed — this fix work and the completed catalogue
sync remain in the working tree pending explicit commit/push
authorization.

## Discover page — broad-catalogue random discovery (2026-08-13)

`/discover` previously queried the Supabase `games` table directly
(`listDiscoverGames`, ordered by `igdb_rating_count`), so it only ever
showed games some user had already opened or a prior backfill had
cached — none of Prompt 7C's 26,676-game synced catalogue was reachable
from it. This redesign samples genuinely at random from the full synced
catalogue, reusing every piece of Prompt 7C's existing infrastructure
(the ledger, Pinecone metadata, the POST-based import boundary, the
mixed cached/catalogue-only rendering `/search` already shipped) rather
than inventing a parallel path.

### Why not `ORDER BY random()`

`igdb_catalogue_sync` (26,676 rows, currently all `status='synced'`) has
no index covering `status='synced'` — only a partial index on
`pending`/`failed`. `ORDER BY random() LIMIT N` there would force a full
sequential scan + sort of the table on _every_ page load and _every_
shuffle click, from an unauthenticated, repeatable-clicking surface —
exactly the cost shape the "don't scan/transfer the whole ledger"
constraint exists to prevent, and one that only gets worse as the
catalogue grows.

### The keyset-seek algorithm

`src/server/services/discover-catalogue.ts`'s `listDiscoverCatalogue`:

1. Two parallel bounds queries — `min(igdb_id)`/`max(igdb_id)` among
   `status='synced'` rows (`.select("igdb_id").order(...).limit(1)`,
   ascending and descending — the same no-native-aggregate idiom used
   elsewhere in this codebase, since PostgREST has no `MIN()`/`MAX()`).
2. A seeded PRNG (mulberry32, `src/lib/random/seeded-random.ts`, seeded
   from the URL's `?seed=`) picks 4 random threshold values in
   `[min, max]`.
3. 4 parallel keyset queries: `.eq("status","synced").gte("igdb_id",
threshold).order("igdb_id",{ascending:true}).limit(8)` — each a real
   indexed range-scan seek off the `igdb_id` primary key, not a full-table
   sort. The primary-key portion of this seek is an indexed `O(log n)`
   descent to the threshold; the accompanying `status` filter isn't
   covered by a composite index, so it's evaluated row-by-row against the
   scan and can inspect (never fetch via a separate index) some
   non-matching rows before the `LIMIT` accumulates — bounded by `LIMIT`,
   not a blanket `O(k)` claim, and at the catalogue's current
   near-100%-synced state this filter is close to a no-op in practice.
4. **Deterministic wrap-around**: a window returning fewer than 8 rows
   (threshold near `max`, nothing left above it) gets exactly one
   supplemental query wrapping to the _global_ `min` — never a new random
   point, so the same seed always makes the same wrap decision.
5. Ids are deduped into a `Set` (the identity mechanism — window overlap
   just reduces unique count, never an error) and Fisher–Yates shuffled
   by the same seeded PRNG.
6. **Hydration determines the real count, not the raw id count**: one
   Pinecone `namespace.fetch({ids})` (canonical ids via
   `buildCatalogueRecordId`, see below) plus one `games`
   `.in("igdb_id", ids)` lookup, mirroring `semantic-search.ts`'s
   existing hydration pattern exactly (`games` row present → cached
   result with its real stored slug; absent but Pinecone metadata passes
   `pineconeCatalogueRecordSchema` → catalogue-only result; neither →
   dropped). A raw pool of 32 ids can still hydrate to fewer than 20
   valid results if enough records are missing from Pinecone or fail
   validation — this is why the next step keys off the _hydrated_ count,
   not the raw id count.
7. **Bounded post-hydration refill**: if hydration yields fewer than 20
   valid results, exactly one more round draws 2 more threshold windows
   (continuing the same seeded PRNG stream, still deterministic),
   excluding every id already attempted in round 1, and hydrates only the
   new ids. This runs at most once, ever, per request — never a retry
   loop.
8. **Three outcomes, not two**: ≥20 valid results renders normally; 1–19
   valid results _after_ the bounded refill renders exactly what's valid
   with an honest "showing fewer games than usual" notice — **never**
   the cached-only fallback, since window overlap, wrap-around, and an
   imperfect refill are all handled in-band, not treated as failures; 0
   valid results, or a genuine ledger/Pinecone read error, is the _only_
   trigger for falling back to `listDiscoverGames` (repurposed —
   unchanged functionally, now Discover's degraded-mode fallback instead
   of its primary source).

Explicit ceilings, none of them loose targets: 4 initial windows + ≤4
wrap-arounds + 2 refill windows + ≤2 refill wrap-arounds = ≤14 total
ledger queries; ≤2 hydration rounds (one Pinecone fetch + one `games`
lookup each). No per-card request anywhere.

**Accepted, documented tradeoff**: a random threshold _value_ isn't
perfectly uniform across _rows_ — dense id-clusters (e.g. a franchise's
platform ports, often imported with adjacent ids) are proportionally
slightly under-represented relative to isolated ids. Correct trade for
staying scan-free and migration-free at this scale; it mildly _helps_
avoid one franchise dominating a selection, since a whole adjacent-id
cluster is less likely to all land in the same draw.

### The diversity pass is separate from sampling, and says so

Keyset sampling produces variety in _which_ games appear across
different seeds — it says nothing about franchise/year/platform spread
_within_ one selection. `applyDiversityPass` is an explicit, separate,
bounded pass over the hydrated pool: candidates with both artwork and a
release year present are stably preferred first, then a greedy walk
respects small per-franchise/year/platform caps (~3/~4/~5) _where
possible_. If the pool can't fill the target while respecting caps, it
relaxes and takes the next candidate anyway — **a preference over order,
never a hard filter**: no valid candidate is ever dropped, and the
target is never missed, purely to enforce diversity. Franchise grouping
(a normalized first-two-words key, via the existing `normalizeGameName`)
never influences identity — two distinct `igdb_id`s sharing a title
always both stay in the pool and can both appear.

### Canonical Pinecone record ids

No shared id builder existed before this — `sync.ts` inlined
`` `igdb-${igdbId}` `` directly at its one call site. Extracted into
`buildCatalogueRecordId` (`src/lib/pinecone/constants.ts`, alongside
`PINECONE_NAMESPACE`/`PINECONE_SCHEMA_VERSION`), and `sync.ts` updated to
use it — the one canonical place this string shape is built, so
discover-catalogue.ts (and any future caller) never reconstructs the
`igdb-` prefix ad hoc.

### Admin-client boundary — narrow, read-only, documented

`igdb_catalogue_sync` has zero RLS grants for anon/authenticated by
design (server-only bookkeeping, same posture as `game_vector_sync`) —
reading it to power a public page necessarily means either the admin
client or a new grant. `discover-catalogue.ts` uses the admin client,
narrowly: `import "server-only"` as the first import; every ledger query
selects **exactly** `igdb_id`, never any other column; every operation in
the module is read-only (no insert/update/delete/upsert anywhere,
covered by tests asserting zero write calls on every mock across every
code path); the admin client itself never appears in any exported return
type. This is treated as safe and narrower than the alternatives: the
data exposed (an already-public IGDB game's id) isn't sensitive or
user-scoped; there's existing precedent for the admin client serving a
normal request mid-flight (`game-sync.ts`'s `upsertGameFromIgdbDetail`,
triggered by an ordinary page view); a new RLS grant would be broader
than needed for a table whose whole design intent is service-role-only;
and a `SECURITY DEFINER` RPC would need its own migration and duplicate
PRNG logic in SQL that's easier to keep in TypeScript next to the
client-side seed generator. No migration was needed anywhere in this
feature — `igdb_id`'s existing primary-key index (ledger) and
unique-constraint index (`games`) are sufficient at the current ~27k-row
scale for both the keyset seek and the batch hydration lookup.

### Abuse and cost control

A new, **separately-keyed** rate limit, `checkDiscoverRateLimit`
(`discover:${clientId}`, 15/60s, `src/server/services/game-catalogue.ts`
alongside the existing `checkImportRateLimit`/`checkCatalogueImportRateLimit`)
— shares no budget with the `game-import`/`catalogue-import` buckets, so
repeated shuffling can never weaken the on-demand-import budget (tested
directly, both directions). Checked inside `listDiscoverCatalogue`
itself (mirroring `searchGamesSemantic`'s existing internal check),
_after_ a same-seed cache lookup, never before: `getCachedSearch`/
`setCachedSearch` (the existing `src/lib/igdb/search-cache.ts` module,
reused as-is, keyed `discover:${seed}`, a distinct prefix from IGDB text
search's own entries) is checked **first** — a cache hit returns
immediately with zero ledger/Pinecone/games calls and never even
consults the rate limiter, so reload/Back/Forward/duplicate tabs on an
already-computed seed cost no quota. Only a _genuine_ successful
selection (full or reduced) is cached — a fallback/error outcome is
never pinned under the seed key, so a transient failure self-heals on
the next request instead of being stuck for the TTL.

### Preventing infinite crawlable URL variants

Every `?seed=` value is a distinct URL — `/discover`'s `metadata` gains
`alternates: { canonical: "/discover" }` so crawlers consolidate every
seed variant onto the bare path rather than crawl-budgeting each one as
its own page. "Shuffle games" is a single real `<button>` (a narrow
client component, `discover-shuffle-button.tsx`) that generates one
fresh `crypto.getRandomValues` seed and does `router.push` (not
`replace`, so Back/Forward steps through shuffle history) — never a
crawlable `<a href>` per seed.

### Stability and hydration-mismatch safety

`/discover` with no (or an invalid) `?seed=` does a `redirect()` to a
freshly-generated seed before rendering anything — every real render is
therefore a pure, deterministic function of the URL's seed. This
structurally guarantees the "no reshuffling on rerender" and "no
hydration mismatch" requirements: zero `Math.random()`/`Date.now()` ever
runs during the render that produces the initial HTML (all randomness is
either server-side and seed-derived, or confined to the shuffle button's
one `onClick` handler, which only ever triggers a fresh navigation, never
a client-side re-render of the existing grid).

### Cached vs. catalogue-only cards — shared, not duplicated

The mixed-grid JSX previously inline in `/search`'s semantic-mode
rendering (`PosterCard` for `source:"local"`, `CatalogueResultCard` for
`source:"igdb"`) is extracted into `GameResultGrid`
(`src/components/games/game-result-grid.tsx`), used by both `/search`
and `/discover` — no behavior change to `/search`, confirmed by its
existing tests passing unchanged. Catalogue-only results still go
through the existing `importCatalogueGameAction` POST boundary,
redirecting to the freshly-imported row's real slug — never a
client-guessed URL.

### Files

New: `src/lib/random/seeded-random.ts`,
`src/server/services/discover-catalogue.ts`,
`src/components/games/game-result-grid.tsx`,
`src/components/games/discover-shuffle-button.tsx`,
`src/app/discover/discover-results.tsx`. Modified:
`src/app/discover/page.tsx` (seed validation/redirect, shuffle button in
`PageHeader`'s action slot, canonical metadata, old prev/next pagination
removed), `src/app/search/search-results.tsx` (uses the extracted
`GameResultGrid`), `src/lib/pinecone/constants.ts`/`sync.ts`
(`buildCatalogueRecordId`), `src/lib/validation/games.ts`
(`discoverSeedSchema`), `src/server/services/game-catalogue.ts`
(`checkDiscoverRateLimit`; `listDiscoverGames` repurposed as the
fallback, functionally unchanged).

Not committed, not pushed. No catalogue discovery/sync was run; no
Pinecone index was touched; no migration was created.

### Manual verification (user, browser, 2026-08-13): PASSED

- `/discover` redirects to a stable seeded URL.
- ~20–24 unique games render from the broad synced catalogue, including
  catalogue-only games not previously cached.
- "Shuffle games" changes both the seed and the displayed selection.
- Browser Back restores the previous seed and selection, in the same
  order — confirming the seeded-determinism design holds under real
  browser history navigation, not just in tests.
- Cached games open through their real stored slug; catalogue-only games
  use the POST import boundary and redirect successfully to
  `/games/<slug>`.
- Imported game pages show genuine IGDB metadata — no fabricated
  ratings, reviews, or activity.
- Keyboard navigation works for the shuffle button and game cards.
- Mobile layout has no horizontal overflow.
- No unexpected browser-console errors.

**The broad-catalogue random Discover feature is complete**, with both
automated verification (659/660 tests, lint/typecheck/format/build/
verify-standalone all clean — see above) and this manual browser pass
green. Still not committed, not pushed.

### ZimaOS scheduling (documented only — not wired)

Once past initial catalogue sync, `incremental`/`release-check` are
natural cron candidates (e.g. daily) for ongoing coverage. Actual
cron/tunnel/deployment wiring is explicitly deferred to the ZimaOS
deployment milestone (Prompt 8's remaining scope) — `CRON_SECRET`
already exists in `env.server.ts`, reserved for that future endpoint;
nothing in Prompt 7C depends on it or wires it up.
