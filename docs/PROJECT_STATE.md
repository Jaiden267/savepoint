# Project state

Continuity notes between prompts. Read this first when picking the project
back up — it says what's actually built, not just what's planned.

_Last updated: 2026-08-12 (Prompt 7C — broad IGDB catalogue semantic
indexing, Gates A1/A2/B/C — **infrastructure complete, automated-checks-
clean, and a real 25-record canary has been indexed. Gates D (bounded
expansion) and E (full sync) remain pending, each behind a separate
explicit approval.**
Gate A1 (migration `20260813120000_add_igdb_catalogue_sync_infrastructure.sql`)
applied and live-verified by the user. Gate A2 built the resumable,
checkpointed catalogue-discovery system (three new tables, one atomic
`advance_catalogue_discovery` RPC, a global fenced lease, per-minute
Pinecone pacing, mandatory operator ceilings), the Pinecone record schema
v2 migration path (`igdb-${igdbId}` record ids, `schema_version`-aware
re-sync), the `igdb_id`-based semantic-search hydration fix, catalogue-
only search-result rendering with a POST-based import boundary, and two
new operator scripts. Live-verified: RPC permissions, compare-and-set
fencing, duplicate-candidate dedup, `xmax`-based counting, and Unix-
seconds timestamp conversion, via a new opt-in
`catalogue:checkpoint-smoke-test` script (all test data cleaned up
afterward, confirmed). Gate B's live estimate confirmed real counts
(conservative 25,083 / balanced 26,676 / broad 29,237); **balanced was
chosen**, and the Pinecone org was separately upgraded from Starter to
**Builder** (10M embedding tokens/month, same 250K/minute passage limit,
flat-rate/no-overage). Gate C ran a real, bounded 25-record `balanced`
canary — discovery and sync both completed cleanly at their declared
ceilings, 25/25 synced with zero failures, zero duplicate `igdb_id`s,
all records confirmed schema v2 live, and **the user manually
browser-verified the full flow (semantic search, POST import, real
metadata with no fabricated data, cache re-hit, keyboard operability, no
console errors) — all PASS.** Two related ceiling gaps were surfaced and
fixed: the per-batch check (once between IGDB pages/sync batches, never
mid-batch) could let a single page/batch overshoot a small `--limit`
before the next check could stop it. Discovery got a bounded `--page-size`
flag. `sync` got a stronger fix — a new `selectWithinTokenBudget()`
(`src/lib/pinecone/token-budget.ts`) now enforces
`--max-estimated-embedding-tokens` **before every upsert**, trimming a
batch rather than ever knowingly sending one over the declared ceiling
(this is what actually happened in the canary: a 25-record batch's
margined estimate came in ~1.8% over its declared 15,000-token ceiling).
Regression-tested (7 new tests). 543/543 automated tests pass. See
"Prompt 7C" below and
[PINECONE.md](./PINECONE.md#broad-catalogue-indexing-prompt-7c) for full
detail, including the Gate C results table. Prompt 8 — design,
responsive layout & accessibility pass — remains **complete, automated-
checks-clean, and fully manually verified by the user, including a
post-completion fix.** Retuned
design tokens (elevation surfaces, solid borders, a targeted
`prefers-reduced-motion` rule), added a mobile nav (bottom tab bar +
drawer, built on `@base-ui/react`'s previously-unused `Drawer` primitive),
consolidated duplicated page-header/pagination/poster-grid markup into
shared components, swept all 25 routes for spacing/responsive consistency,
and fixed a batch of real accessibility gaps found during the pass
(spoiler-reveal semantics, two missing form labels, one icon-button
accessible-name regression risk). New [DESIGN.md](./DESIGN.md) records the
token/component/a11y conventions. The user's full manual browser
checklist then passed every item, and separately surfaced one real gap —
semantic search worked at `/search?mode=semantic` but had no discoverable
route from the visible navigation — fixed with an "Open full search" link
in the ⌘K dialog (mentions both Standard and Semantic modes, preserves and
URL-encodes any in-progress query, closes on navigation, Tab-reachable),
covered by 8 new regression tests, and **re-verified by the user as
passing.** See "Prompt 8" below for full detail. Prompt 7 — Pinecone
semantic search — remains **semantic search half complete and fully
manually verified** (superseded in scope, not in status, by Prompt 7C
above); Prompt 5 — lists, social & profiles — remains **complete and
fully manually verified**; Prompt 4 — core tracking — remains **complete
and fully manually verified**; all histories are preserved below
unchanged.)._

## Prompt 8 — Design, responsive layout & accessibility pass

Full architecture and conventions live in [DESIGN.md](./DESIGN.md); this
section tracks completion status only. Scope: a design/responsive/
accessibility pass over the existing app — no product scope changed, no
new pages, no Recommendations work.

**Design tokens** (`src/app/globals.css`): retuned the OKLCH neutral
palette against real hex targets (converted with an actual OKLCH
conversion, not eyeballed) — a new `--surface-1` elevation step, `--card`/
`--popover` redefined as `--surface-2`, `--border`/`--input` switched from
alpha-white to solid, `--border-subtle` kept for on-artwork overlays.
Collapsed the byte-identical `:root`/`.dark` duplication (dark-first, no
light theme exists). Added a semantic motion-duration scale and a
**targeted** `prefers-reduced-motion` rule — it does not blanket-zero every
animation; `.animate-spin` (the two real functional spinners in
`submit-button.tsx`/`add-game-to-list-dialog.tsx`) is explicitly exempt so
in-progress indicators keep visibly indicating progress, and transitions
stay at a real (if short) non-zero duration so Base UI's Dialog/Drawer
open/close lifecycle still observes a genuine transition.

**Mobile navigation** (new): `src/components/ui/drawer.tsx` wraps
`@base-ui/react/drawer` (already a dependency, previously unused — no new
package). Its exact API was verified against the installed `.d.ts` files
rather than assumed — there is no `side` prop (direction is
`swipeDirection`), and `Popup` must render inside `Viewport` or touch
scroll-locking/swipe handling silently breaks (a real defect the test
suite itself caught via a Base UI console warning, then fixed). Focus
trap, focus-on-open, focus-return-on-close, Escape-close, backdrop-click-
close, and scroll-lock are all confirmed by real tests in
`drawer.test.tsx`, not assumed. `MobileNavBar` (fixed bottom tab bar, 5
primary signed-in destinations) and `MobileNavDrawer` (hamburger →
Community/Profile/Settings/Sign-out) are new; both receive `user`/
`username` as props from `site-header.tsx`'s single existing Supabase
fetch — no duplicate auth queries. Bottom-bar spacing is reserved via a
`body:has([data-mobile-nav-bar])` CSS rule scoped to the mobile media
query, so it self-cancels on desktop and never applies on signed-out pages
that don't render the bar. **A real composition bug was found and fixed
during testing**: composing nav links via `DrawerClose`'s `render` prop
forces `role="button"` onto the composed `<Link>` regardless of the
`nativeButton` flag, breaking real link semantics — the same trap
`link-button.tsx`'s own comment already documents for Base UI's `Button`.
Fixed by using a controlled `Drawer` with plain `<Link onClick={() =>
setOpen(false)}>` elements instead.

**Shared primitives** (new): `PageHeader` and `Pagination`
(`src/components/common/`) replace duplicated markup across ~14 routes;
`poster-grid.tsx` now exports `GRID_CLASSES` for the two routes that render
a different card component in the same grid shape.

**State-file audit**: reviewed all 7 existing `loading.tsx` files and both
Suspense-fallback call sites (`discover/community`, `search`) — all
already shape-matched their real content, no changes needed. Added 2 new
`loading.tsx` files for real latency-risk gaps: `/games/[slug]` (an
on-demand IGDB fetch on a cache miss) and the `/users/[username]` overview
tab (the one profile tab without one, despite the same `Promise.all`-of-
Supabase-queries latency profile as its 6 siblings, each of which already
had one). `error.tsx`/`not-found.tsx` (×3) confirmed already token-driven
and honestly worded — no changes needed.

**Route sweep**: wired `PageHeader`/`Pagination`/`GRID_CLASSES` into
`/home`, `/discover`, `/discover/community`, `/search`, `/diary`,
`/library`, `/lists/new`, `/settings/profile`, and all six
`/users/[username]/*` tabs. Added `scroll-fade-x` (an existing, previously
unused Tailwind v4 utility) to `ProfileNav`'s already-scrollable tab bar.
Spot-checked `/games/[slug]`, `/reviews/[id]`, `/lists/[id]`,
`/lists/[id]/edit`, the `(auth)` pages, and `/onboarding` for nested-
interactive-control and spacing issues — none found; those routes' custom
header shapes were intentionally left as-is (a badge next to a title, an
avatar+stats grid, a centered auth card don't fit `PageHeader`'s plain
shape).

**Accessibility fixes found and made this pass**:

- Spoiler reveal (`review-card.tsx`): the reveal button now has
  `aria-expanded`/`aria-controls`, and the container is `aria-live="polite"`
  so screen readers announce the body's appearance — neither existed
  before.
- `avatar-uploader.tsx`: the client-side file-validation error rendered as
  a bare, unassociated `<p>` — now a real `FieldError` wired via
  `aria-describedby`/`aria-invalid`.
- `list-item-row.tsx`: the per-item note `<Textarea>` had no label at all
  (placeholder-only) — added a real `sr-only` label.
- `search-command-dialog.tsx`: the ⌘K trigger lost its only accessible
  name below `sm:` (its label text is `hidden` at that breakpoint, which
  removes it from the accessible tree) — fixed with an explicit
  `aria-label`.
- Touch targets: audited against a real ≥44×44px (primary mobile
  controls) / ≥24×24px (everything else, WCAG 2.2 SC 2.5.8) floor — no
  overlapping pseudo-element hit-area tricks. `reorder-controls.tsx`
  already complied (28px `icon-sm` buttons); the new mobile-nav controls
  were built to comply from the start.
- Destructive-action confirmation: confirmed `DeleteListButton`/
  `DeleteDiaryEntryButton`/review deletion (via `review-composer.tsx`) all
  already use the same `Dialog`-confirm pattern — no gap found.

**Testing**: `vitest-axe` (`^0.1.0`) added as a devDependency — real
axe-core scans wired into `drawer.test.tsx`, `mobile-nav-bar.test.tsx`,
`mobile-nav-drawer.test.tsx`, `page-header.test.tsx`, `pagination.test.tsx`,
`star-rating-input.test.tsx`, plus 2 spot-checks on existing tests
(`log-diary-entry-dialog.test.tsx`, `empty-state.test.tsx`) — not
blanket-added everywhere. **Its `toHaveNoViolations()` matcher's type
declarations don't work against this project's Vitest 4** (confirmed by
an isolated repro, not assumed from the version number — the matcher
augments a pre-Vitest-4 global namespace that no longer merges with
Vitest 4's actual `Assertion<T>` interface). `src/test/axe.ts` exports a
small, fully-typed `expectNoAxeViolations()` helper built directly on the
raw `axe-core` results instead; every axe test in this repo uses that, not
the matcher. One genuinely racy test assertion was found and fixed during
verification (`drawer.test.tsx`'s "moves focus into the popup on open"
flaked under concurrent test-file load, not in isolation) — wrapped in
`waitFor()`, matching the codebase's existing convention for this class of
timing assertion.

**Automated verification**: `npm run lint` (0 errors), `npm run typecheck`
(clean), `npm test` (**454/454**, 61 files — up from 444 before this
pass), `npm run format:check` (clean, after one `npm run format` pass),
`npm run build`, and `npm run verify-standalone` — full results in
"Verification" below.

**Manual browser verification (performed by the user, passed).** The
browser preview tool was unavailable to the assistant for the entire
implementation session (navigation and screenshot calls both failed with
"the Browser pane is not displayed"), so every fix above was verified
through source review and real automated tests (including the ones that
caught the `Drawer.Viewport` and `DrawerClose`-`render`-prop defects) —
nothing was visually inspected in-session. The user then personally ran
the full manual checklist against the real app and confirmed every item
passed:

- Responsive layouts checked at 360px, 768px, 1024px, and 1440px.
- Signed-in and signed-out navigation states both work correctly.
- The mobile bottom navigation and hamburger drawer both work correctly.
- No content is obscured by the bottom navigation.
- No unexpected horizontal overflow at any of the checked widths.
- Keyboard navigation, Drawer/Dialog focus trapping, Escape-to-close, and
  focus-return all work.
- Star-rating keyboard interaction and spoiler reveal both work.
- Form labels, errors, and pending states spot-checked — correct.
- `prefers-reduced-motion` preserves functional drawers, dialogs, and
  progress indicators (matching the targeted, non-blanket rule design
  above).
- No new browser-console or hydration errors observed.

**Post-completion fix: semantic-search discoverability (this pass).** The
user's manual pass surfaced one real gap: semantic search worked at
`/search?mode=semantic`, but nothing in the visible navigation — desktop
or mobile — offered a route to the full `/search` page (and its
Standard/Semantic toggle) short of typing the URL by hand. Fixed with the
smallest change that closes the gap: `search-command-dialog.tsx`'s ⌘K
dialog gained an **"Open full search"** link at the bottom of its results
panel, labelled to mention both search modes ("Standard & Semantic"), so
the destination and its capabilities are discoverable before the page even
opens. It's a real `<Link>` (not a mouse-only affordance) — Tab-reachable
right after the search input — with `href` set to `/search` or
`/search?q=<query>` (URL-encoded) depending on whether anything was
typed, so an in-progress search carries over instead of being lost. It
closes the dialog on click so it doesn't linger open over `/search` (the
same fix pattern already used for the mobile nav drawer). The mobile
bottom nav's existing "Search" tab needed no change; because the ⌘K
dialog itself is visible in the header at every viewport for both
signed-in and signed-out visitors, this same fix also closes the gap for
signed-out mobile users, who have no bottom tab bar at all. No change to
Pinecone, IGDB, indexing, ranking, or `/search`'s own architecture — the
existing Standard/Semantic toggle and its behavior are untouched, only the
path _to_ it changed.

Eight new regression tests in `search-command-dialog.test.tsx` cover: the
link's href with no query and with a query, URL-encoding of special
characters, trimming a whitespace-only query back to plain `/search`,
Tab-reachability, the "Standard & Semantic" wording surfacing in the
link's accessible name, the dialog closing on click, and that the existing
Enter-to-jump-straight-to-a-game quick-search path is unchanged. `npm run
lint` (0 errors, same 4 pre-existing warnings), `npm run typecheck`
(clean), `npm test` (**462/462**, 61 files — up from 454), `npm run
format:check` (clean), `npm run build` (all 29 routes), and `npm run
verify-standalone` (5/5) all re-run clean after this fix.

**Manual re-verification (performed by the user, passed)**: "Open full
search" is clearly visible in the global search dialog; its accessible
wording mentions Standard and Semantic search; entered queries are
preserved and URL-encoded when opening `/search`; the dialog closes after
navigation; the action works with keyboard-only navigation via Tab and
Enter; the existing Enter-to-open-game behaviour still works; the mobile
Search navigation still reaches `/search`; the Standard/Semantic toggle is
visible on arrival and semantic search returns the currently indexed
Savepoint games; no new browser-console or hydration errors appeared.

**Prompt 8 is complete — nothing about it is outstanding, including the
semantic-search discoverability gap found and fixed during manual
verification.**

## Prompt 7 — Phase A (this pass, implementation complete)

Labelled "Prompt 7" per [ROADMAP.md](./ROADMAP.md)'s existing numbering —
"Prompt 6 — Lists" was already merged into Prompt 5 and left as a
placeholder line so numbering would never shift.

Full architecture and rationale live in [PINECONE.md](./PINECONE.md); this
section tracks completion status only.

**No migration required or created.** `game_vector_sync` (migration 6) has
had exactly the needed shape — `status`/`attempt_count`/`last_attempted_at`/
`error`/`last_synced_at`, zero grants for `anon`/`authenticated` — since
Prompt 1. The entire concurrency-safe sync design (a recoverable lease built
from those existing columns) required no schema change.

Split on an external-mutation boundary instead of a database-migration one:
application runtime code never creates, deletes, or mutates the Pinecone
index — only `scripts/pinecone-bootstrap.mts`, run manually, is permitted
to call `createIndexForModel`. Phase A (this pass) implements and tests
every module against a **mocked** Pinecone SDK; no real index exists yet.

**Written and tested this pass:**

- `src/lib/pinecone/`: `constants.ts`, `index-compat.ts`, `record-text.ts`,
  `error-sanitizer.ts` (pure), `client.ts` (describe/validate only, never
  creates), `sync.ts` (lease-based concurrency-safe `syncGameVector`),
  `search.ts` (`searchGameIds` — no Supabase dependency at all).
- `src/server/services/game-refs.ts` (extracted shared join-fetch, second
  real call site alongside `src/app/games/[slug]/page.tsx`, which was
  refactored to use it) and `semantic-search.ts` (rate-limited, Zod-
  validated, request-scoped-client-only orchestration with lexical
  fallback).
- `src/server/services/game-sync.ts`: the `game_vector_sync` pending-upsert
  now also resets `last_attempted_at: null` so a freshly (re)imported game
  is immediately claimable rather than looking like it's under an active
  sync lease.
- `after()` wired at the two confirmed dynamic request call sites
  (`/games/[slug]` page render, `addListItemAction`) — best-effort,
  non-blocking, never inside the generic reusable import helper.
- `/search/page.tsx`: lexical/semantic mode toggle, fallback notice.
- `scripts/pinecone-bootstrap.mts` (administrative, manual-only),
  `scripts/pinecone-backfill.mts` (resumable, bounded, self-concurrency
  lock, same lease protocol as `sync.ts` reimplemented inline),
  `scripts/pinecone-smoke-test.mts` (read-only Phase B verification) — new
  `npm run pinecone:bootstrap` / `pinecone:backfill` / `pinecone:smoke-test`
  scripts.
- Unit tests for every module above, including the lease-specific scenarios
  (second worker arriving mid-claim, recovery after an expired lease, an
  older worker's finalize write losing to a newer claim, a freshly
  re-imported game being immediately claimable, zero Pinecone calls under
  an active lease).
- `docs/PINECONE.md` (new, full architecture).

**Stop condition for this pass**: all automated checks
(lint/typecheck/test/format/build) clean, `next build` output checked to
confirm `/games/[slug]` and `/search` are not statically generated.

**Post-Phase-A fix**: the user's first `npm run pinecone:bootstrap` attempt
failed before executing anything (`ERR_MODULE_NOT_FOUND` —
`src/lib/pinecone/index-compat.ts` imported its sibling `./constants`
without a file extension; this works under webpack/Vitest but not under
Node's native TypeScript type-stripping, which the four `scripts/*.mts`
files rely on and which requires explicit extensions). Fixed by adding
explicit `.ts` extensions to every relative import across
`src/lib/pinecone/*.ts` (already permitted project-wide by tsconfig's
`allowImportingTsExtensions`) — no new runner added, native Node
type-stripping remains the tool, consistent with the other three scripts.
While verifying the fix, a second real bug surfaced: `pinecone-backfill.mts`
called `process.exit(1)` directly inside its `try` block on a missing
index, which skips `finally { releaseLock() }` and leaks the self-
concurrency lock file — fixed by throwing instead and setting
`process.exitCode` at the top level, after the lock is released. Also added
`npm run pinecone:bootstrap -- --check` (alias `--dry-run`): fully loads
modules, validates env, authenticates, lists/describes indexes — never
creates/deletes/configures/upserts anything — used to verify both fixes
before the real (mutating) bootstrap ran.

## Prompt 7 — Phase B (this pass, live-verified)

The user ran `npm run pinecone:bootstrap` and confirmed success: index
`savepoint-games`, namespace `games`, model `llama-text-embed-v2`, deletion
protection `enabled`, no error. Phase B then ran, in order:

1. `npm run pinecone:bootstrap -- --check` (read-only) — confirmed the live
   index is compatible: `isIndexCompatible()` passed, host resolved,
   `deletionProtection: enabled`.
2. `npm run pinecone:backfill -- --limit 5` (bounded, exactly 5 — no more)
   — **5 candidates fetched, 5 claimed, 5 synced, 0 failed, 0 skipped** of
   any kind. Confirms the claim-first lease protocol, the join-fetch, the
   text/field builders, and the real `upsertRecords` call all work
   end-to-end against the live index.
3. `npm run pinecone:smoke-test` (read-only) — the three example queries
   ("atmospheric science-fiction exploration", "cosy farming game with
   relationships", "difficult tactical RPG with meaningful choices") each
   returned 5 hits (15 total, 0 failures). **Every single hit resolved to a
   genuine Supabase `games` row** (real name/slug/uuid printed for each —
   no "no matching Supabase row" lines, which would indicate a stale-index
   orphan) — confirms the id-based mapping back to Supabase is correct, not
   just that Pinecone returned _something_.
4. Final state: **index `savepoint-games`, namespace `games`, 5 records** —
   confirmed via `describeIndexStats()` in the backfill run's own summary.
   No credential values or raw upstream error bodies were ever printed at
   any step (all scripts route errors through
   `sanitizeErrorForStorage()`/fixed labels only).

No index was created, deleted, recreated, or reconfigured this pass (only
the one prior `npm run pinecone:bootstrap` run, done by the user, did
that). No more than the bounded 5-game batch was upserted. Recommendations
and `recommendation_feedback` were not started. No Supabase migration was
created — none was needed.

**Manual browser verification (passed)**: semantic mode loads successfully,
semantic results render from the live Pinecone index, no lexical-fallback
warning appeared, the Standard/Semantic toggle works, no browser error page
appeared.

**Coverage clarification found during manual testing**: semantic search
only covers games already imported into Savepoint's Supabase cache _and_
synced to Pinecone — it does not discover arbitrary games from the wider
IGDB catalogue. As of this writing that means only the 5 games from the
bounded Phase B backfill are semantically searchable. This is expected
under the approved on-demand cached-game indexing architecture and the
deliberately bounded 5-game Phase B backfill — **not a defect.** Lexical
search is unaffected (it still falls back to a live IGDB query for
uncached titles, as before). See
[PINECONE.md](./PINECONE.md#coverage-cached-games-only-not-the-wider-igdb-catalogue)
for full detail. Broadening coverage (organic imports over time, or a
larger backfill/bulk IGDB ingestion) is out of scope for this pass.

## Prompt 7C — Gate A1/A2 (this pass, infrastructure only — no live indexing run)

Expands semantic search from cached-only to a broad, curated IGDB
catalogue slice. Plan went through four review rounds before approval,
each round catching real correctness/safety gaps (a UUID-vs-igdb_id
hydration bug, an incomplete incremental-discovery design, the checkpoint
RPC's privilege model, a Unix-seconds timestamp-cast bug, missing
per-minute Pinecone pacing, and others) — see the plan file's own revision
history for the full account. Full design in
[PINECONE.md](./PINECONE.md#broad-catalogue-indexing-prompt-7c); this
section is the changelog.

**Gate A1** (migration only, stop for manual application): one new file,
`supabase/migrations/20260813120000_add_igdb_catalogue_sync_infrastructure.sql`
— `game_vector_sync.schema_version` (additive column), three new tables
(`igdb_catalogue_discovery_cursor`, `igdb_catalogue_sync`,
`igdb_catalogue_lease`), the `advance_catalogue_discovery` RPC, and its
`REVOKE`/`GRANT` statements (service_role only). Applied by the user via
the linked Supabase CLI and confirmed live in both local and remote
migration history.

**Gate A2** (after the user confirmed application):

- `src/types/database.ts` regenerated from the linked live project
  (`supabase gen types typescript --linked`) and reviewed diff-by-diff —
  exactly the three new tables, the new column, and the RPC's args/return
  type, nothing else.
- Live verification (`scripts/catalogue-checkpoint-smoke-test.mts`, new
  opt-in script, real database, all test data cleaned up afterward and
  independently re-confirmed clean): anon rejected end-to-end through
  PostgREST; the real compare-and-set sequence (page A → page B → retry
  of B is a no-op → a delayed retry of A after B is rejected → a wrong
  lease token is rejected before any mutation); duplicate-igdb_id-within-
  one-page dedup; `xmax`-based new-vs-encountered counting; Unix-seconds
  → `to_timestamp()` round-trip correctness, including two rows sharing
  an identical timestamp persisting distinctly. All 14 checks passed on
  the second run (the first run had two assertion bugs in the _test
  script itself_ — confirmed by the underlying arithmetic — not in the
  RPC).
- Core Pinecone modules moved to schema v2: `record-text.ts`
  (`schema_version`, `igdb_updated_at`, `game_modes`; `game_id` dropped),
  `sync.ts` (`igdb-${igdbId}` record ids, `schema_version`-aware re-sync
  so a legacy v1 row self-heals on next touch instead of waiting on the
  unrelated 14-day content TTL), `search.ts` (`PineconeHit` keyed on
  `igdbId`, not a Supabase id), `semantic-search.ts` (hydrates by
  `igdb_id`, never `id` — the fix for a real bug the plan review caught:
  a v2 record's own top-level id is `igdb-*`, and an `.in("id", ...)`
  filter against a `uuid` column would throw), plus catalogue-only result
  rendering and dedupe-by-`igdb_id`.
- New pure modules: `src/lib/igdb/catalogue-profile.ts` (profile
  definitions, server-side `where`-clause builders, client-side
  eligibility predicate — kept in agreement by a dedicated test),
  `src/lib/pinecone/catalogue-page-key.ts` (deterministic idempotency-key
  construction from the complete canonical mutation payload),
  `src/lib/pinecone/lease.ts` (the global fenced lease),
  `src/lib/pinecone/embed-rate-pacer.ts` (per-minute Pinecone pacing).
- New operator-run scripts: `scripts/igdb-catalogue-estimate.mts` (Gate
  B, read-only), `scripts/igdb-catalogue-sync.mts` (`discover`/
  `incremental`/`release-check`/`sync`/`status`/`verify`, dry-run
  default, mandatory ceilings on `--execute`, the global lease, SIGINT/
  SIGTERM with correct exit codes — never 0 for an interruption).
  Dry-run-tested live against real IGDB/Pinecone reads (no mutation):
  `status`, `verify`, and `discover --profile balanced` all ran
  correctly; a `discover --limit 5` dry-run correctly stopped after one
  page with exit code 0.
- New POST-based on-demand import boundary for catalogue-only search
  results: `src/server/actions/games.ts`'s `importCatalogueGameAction`
  and `src/components/games/catalogue-result-card.tsx`, wired into
  `/search/page.tsx`'s semantic-mode results — see PINECONE.md for why a
  plain GET-triggered `<Link>` (the existing, still-correct pattern for
  lexical fallback results) wasn't extended to this much larger surface.
- 536/536 tests pass (up from 462), including new coverage for every item
  above plus a dedicated UUID-vs-igdb_id regression test proving the
  Postgres invalid-uuid bug class can't occur.
- Docs updated: this file, [PINECONE.md](./PINECONE.md),
  [IGDB.md](./IGDB.md), [ARCHITECTURE.md](./ARCHITECTURE.md) (also fixed
  two pre-existing stale-doc-drift spots: the IGDB/Pinecone "placeholder"
  language and the "not linked to remote Supabase" line, both outdated
  since Prompts 3/7 landed), [ROADMAP.md](./ROADMAP.md).

**Not done this pass, by design**: no real IGDB catalogue discovery, no
Pinecone catalogue upsert, no `--execute` invocation of either new
script. Gate B (read-only estimate + profile choice) through Gate E (full
background sync) each require a separate, explicit future approval.

## Prompt 5 — Phase A (this pass)

Prompt 5 combines what the original roadmap sketched as two separate
milestones ("Graph & feed" and "Lists") into one task: lists (CRUD, public/
unlisted/private visibility, ranked/unranked, reordering, per-item notes),
follows, an `activity_events` home feed, complete profile pages, and
discovery (user search, popular public lists, recent public reviews). See
[ROADMAP.md](./ROADMAP.md) for the renumbering note.

The schema for lists/follows/activity plumbing has been fully live since
Prompt 1 (`lists`, `list_items`, `follows`, `activity_events`, their RLS,
and the `fn_log_list_activity()`/`fn_log_follow_activity()` triggers) —
confirmed by reading the applied migration SQL directly, not assumed from
docs. Two genuine gaps needed one new, additive migration, split into two
hard-separated phases because the application code depends on database
objects that don't exist in `src/types/database.ts` until the migration is
both applied live **and** regenerated:

- **Phase A (this pass, complete)**: wrote
  `supabase/migrations/20260813090000_add_social_lists_aggregates.sql` —
  two `security_invoker = true` views
  (`user_rating_distribution`, a bounded ≤10-row-per-user rating histogram
  for the profile page; `list_public_summary`, `lists.*` plus `item_count`
  so "popular public lists" can sort by it, since PostgREST can't `order=`
  on an embedded child aggregate) and one `security invoker` function
  (`reorder_list_items(p_list_id, p_item_ids)` — atomic ranked-list
  reordering in one transaction, using exactly the same-transaction
  deferred-constraint behavior `list_items`'s existing
  `unique(list_id, position) deferrable initially deferred` was built for;
  runs as the calling user, so it cannot bypass RLS — not a reversal of
  Prompt 4's "no RPC" decision, which was specifically about avoiding a
  `security definer` bypass for a different problem). All three objects
  have explicit `revoke`/`grant` statements (migration 16 hardened default
  privileges for future objects too, so nothing here can rely on an assumed
  platform default), plus a `do $$ ... $$` block inside the migration itself
  that asserts those grants via `has_table_privilege`/
  `has_function_privilege` and fails the migration if any are wrong, rather
  than applying silently-incorrect privileges.

  `scripts/verify-schema.mts` (anonymous/publishable-key-only, unchanged in
  every other respect) was extended with: both new views added to the
  existing public-read check list, and a new anon-EXECUTE-denied check for
  `reorder_list_items`. This script can only ever speak to what the `anon`
  role can do — it has no way to obtain a real authenticated session, so the
  authenticated-non-owner runtime case (a signed-in User B calling
  `reorder_list_items` against a list they don't own) is **not** covered
  here; it's deferred to Phase B's real two-user manual checklist, where an
  actual second authenticated session exists. The static
  authenticated-role grants (SELECT on both views, EXECUTE on the function)
  are covered by the migration's own privilege-assertion block, not by this
  script.

  `npm run lint` (0 errors, the same 4 pre-existing style warnings from
  before this pass), `npm run typecheck` (clean — the one `as never` pair in
  the new RPC-denial check is the same narrow, call-site-scoped pattern
  already used throughout `verify-schema.mts` for values not yet in the
  generated type, not a general bypass; it's expected to stay harmless, not
  necessarily be removed, once Phase B regenerates types), and `npm test`
  (**292/292**, unchanged — nothing in Phase A added or touched a test)
  were all re-run clean after these changes.

  **Not committed, not pushed** — this migration is written but not yet
  applied to the live Supabase project.

- **Phase B (this pass, implementation complete)**: the user applied
  migration 19 via the Supabase CLI (confirmed in both local and remote
  migration history, `npm run verify-schema` passed including the new
  anonymous checks, no migration repair used). `src/types/database.ts` was
  regenerated for real (`supabase gen types typescript --linked`) and
  diffed against the pre-regeneration file first: the diff contained
  **exactly** the expected additions — `Views.user_rating_distribution`,
  `Views.list_public_summary`, `Functions.reorder_list_items`, plus one
  harmless extra `list_items → list_public_summary` relationship entry
  (Supabase's relationship inference picking up the view's own `id`
  column) — every one of the 21 pre-existing tables was byte-identical in
  content (only CLI-vs-Prettier formatting differed). No unexpected
  removals or unrelated schema changes. All Prompt 5 application code was
  then implemented against these real generated types — no `as any`, no
  untyped Supabase client casts, no hand-written type patches.

  **What was built**: `src/lib/validation/{lists,follows}.ts` +
  `common.ts`'s new `cursorSchema`; read services
  `src/server/services/{avatar,review-hydration,lists,follows,activity-feed,
discovery,profile}.ts` (`avatar.ts`/`review-hydration.ts` hoisted out of
  duplicated logic in `game-social.ts`/`reviews.ts`, which were refactored
  to use them; `reviews.ts` also gained `listUserReviews` for the profile
  Reviews tab); Server Actions `src/server/actions/{lists,follows}.ts`
  (`reorderListItemsAction` calls the new `reorder_list_items` RPC in one
  atomic round trip; `addListItemAction` imports via the existing
  `importGameByIgdbId()` with its own rate-limit bucket;
  `toggleFollowAction` mirrors `toggleReviewLikeAction`'s idempotent-toggle
  template); `src/lib/auth/route-policy.ts` gained `isGatedPath()` (replacing
  the old exported `GATED_PATHS` Set) plus a segment-aware
  `/^\/lists\/[^/]+\/edit$/` pattern matcher, with `session.ts` switched
  over to it — the single-source-of-truth fix from Prompt 4's `/diary`
  regression, generalized to pattern-matched paths; new components under
  `src/components/{lists,social,profile,activity}/`; new routes
  `/home`, `/discover/community`, `/lists/new`, `/lists/[id]`,
  `/lists/[id]/edit`, and a full nested-route rebuild of
  `/users/[username]` (`layout.tsx` + `page.tsx` + `library/`, `diary/`,
  `reviews/`, `lists/`, `followers/`, `following/`, each with its own
  `loading.tsx`, plus one `not-found.tsx`) — replacing the old single-page
  Prompt 2 version. `site-header.tsx` gained Home/Community nav links.

  **Design decisions carried through from the plan, confirmed in the real
  code**: the activity feed re-checks every event's _current_ object
  visibility at read time through the ordinary RLS-scoped session client
  (never `admin.ts`) before rendering — a list gone private/unlisted, or
  any deleted object, is silently dropped, and the next-page cursor is
  derived from the last _raw_ fetched row so pagination never skips or
  duplicates an event even when a page renders short after suppression.
  Every public surface (`/users/[username]`, `/lists/[id]` for
  public/unlisted) takes a nullable viewer id throughout and renders fully
  signed out. `getProfileLists`/`getPopularPublicLists` add an explicit
  `visibility = 'public'` filter on top of RLS to keep `unlisted` lists out
  of browsable indexes while still reachable by direct link.

  **Verification, all clean on this pass**: `npm run lint` (0 errors, the
  same 4 pre-existing style warnings, none new), `npm run typecheck`
  (clean against the real regenerated types), `npm test`
  (**371/371**, 48 files — up from 292 before this prompt), `npm run
format:check` (clean, after one `npm run format` pass normalized ~20
  files this prompt touched), and `npm run build` (all 29 routes, including
  every new one, compiled clean). Not committed, not pushed.

- **Prompt 5 — manual verification (this pass, complete)**: the user
  personally ran the full live two-user/one-private-list checklist in
  [docs/SOCIAL.md](./SOCIAL.md#manual-two-user--one-private-list-checklist)
  against the real app — **all 16 items passed**: private-list creation
  with an item note; a private list 404s for a signed-out visitor and for
  User B, and is absent from User A's public Lists tab; an unlisted list is
  reachable by direct URL but absent from both the Lists tab and
  `/discover/community`; a public list appears in both; keyboard-only
  up/down/top/bottom reordering persists after reload; removing a game,
  importing/adding a replacement, and an existing item note all persist;
  deleting a list redirects correctly and 404s for everyone afterward;
  follow/unfollow (including duplicate-click protection) persists
  correctly; a followed user's public list, review, and diary activity all
  appear in the follower's `/home` feed; making that list private removes
  its feed event while leaving the unrelated review/diary events intact;
  deleting the review removes its feed event and 404s its permalink;
  signed-out visitors render every public page fully with no owner-only
  controls leaking; `/home` and `/lists/new` redirect signed-out visitors
  to the correct `/login?next=...` destination, and incomplete-profile
  visitors to `/onboarding`. No browser console or standalone-server
  terminal errors were observed during testing, and User B was separately
  confirmed unable to reach User A's private list or its edit page, or see
  reorder controls on it. **Prompt 5 is complete — nothing about it is
  outstanding.**

  One thing intentionally not covered by this live pass, by design: the
  authenticated-non-owner rejection path of the `reorder_list_items`
  database function (a signed-in User B calling it directly against a list
  they don't own) was verified via the migration's own
  `has_table_privilege`/`has_function_privilege` assertions and the mocked
  unit tests in `src/server/actions/lists.test.ts` — not via a manual
  token-extraction request, which the user correctly avoided rather than
  handling raw auth tokens in DevTools. This is a deliberate, narrower
  verification method for that one specific path, not a gap.

## Where things stand

**Prompt 2 is complete** (all 17 migrations confirmed live, manual testing
passed including a retest, both bugs found during testing fixed — see the
Prompt 2 section below for the full history).

**Prompt 3 (IGDB integration) is complete.** Both phases ran and passed:

- **Phase A:** `src/lib/igdb/` is a real implementation (no longer the
  placeholder), the local catalogue/import services, the new UI
  (`/discover`, `/search`, `/games/[slug]`, the ⌘K search command dialog),
  and migration 18 were all written and locally verified (lint/typecheck/142
  tests/build all clean) against a hand-patched `src/types/database.ts`.
- **Phase B (this pass):** the user applied migration 18
  (`20260812100000_add_igdb_game_metadata.sql`) via the Supabase CLI and
  confirmed local/remote migration history match. After that:
  1. `src/types/database.ts` was regenerated for real
     (`supabase gen types typescript --linked`) and diffed against the
     hand-patch first — **byte-identical**, confirming the patch was
     accurate. The manual-patch banner is removed; the file is now a plain,
     unmodified generated output.
  2. `npm run verify-schema` re-run live: **44/44 passed** (up from 40 — the
     4 new tables `game_modes`/`themes`/`game_game_modes`/`game_themes`
     confirmed public-read, no write grant, exactly as designed).
  3. `npm run igdb:smoke-test` run live, once, for real — **6/6 passed**:
     Twitch token obtained (never printed), IGDB search for "The Legend of
     Zelda: Breath of the Wild" correctly ranked the canonical title first,
     full detail fetched, imported into the live Supabase project, and
     **imported a second time to confirm idempotency: exactly 1 `games` row
     and un-duplicated `game_genres` rows afterward.**
  4. `npm run lint`, `npm run typecheck`, `npm test` (**142/142**),
     `npm run format:check`, and `npm run build` (all 16 routes) all re-run
     clean after the type regeneration.

**Live test data imported by the smoke test** (not auto-deleted — cleanup is
optional, at the user's discretion):

| Field         | Value                                    |
| ------------- | ---------------------------------------- |
| Name          | The Legend of Zelda: Breath of the Wild  |
| IGDB id       | 7346                                     |
| Slug          | `the-legend-of-zelda-breath-of-the-wild` |
| Internal uuid | `4dd1ceb8-3446-4167-a4b7-174a8e9e0a58`   |

Cleanup SQL (cascades to every join table + `game_vector_sync`), run only if
you don't want this real game sitting in the catalogue:

```sql
delete from games where igdb_id = 7346;
```

There's no product reason to remove it — it's a real, valid game, and having
one real row is useful for eyeballing `/discover` and `/games/the-legend-of-zelda-breath-of-the-wild`
in the browser.

All 18 migrations are now confirmed applied — `supabase migration list`
shows local/remote matching, and `npm run verify-schema` (read-only, live,
anon-key-only) passes **44/44** against the current live schema. Dashboard
URL configuration is confirmed set: Site URL `http://localhost:3000`,
Redirect URLs include the exact `/auth/callback` and a `localhost/**`
wildcard, Email auth + Confirm Email are enabled — matching exactly what
[AUTH.md](./AUTH.md#dashboard-configuration-required) asked for.

**The full [manual integration checklist](./AUTH.md#manual-integration-checklist)
has been run against the live app and passed**, including two rounds of bug
fixes surfaced by that manual pass (see "Bugs found and fixed during manual
testing" below). Every item passed: signup, confirmation email, PKCE
callback, onboarding, profile editing, avatar upload, avatar replacement,
avatar removal (fixed and retested — see below), public profile, protected-
route redirects, sign out/in, forgot/reset password.

### Bugs found and fixed during manual testing

1. **Avatar removal did nothing.** Upload and replacement worked, but
   clicking "Remove" silently had no effect. Root cause: `AvatarUploader`
   rendered the Remove button's `<form action={removeAction}>` nested inside
   the upload form's `<form>` — invalid HTML that browsers silently refuse to
   submit. Fixed in
   [avatar-uploader.tsx](../src/components/profile/avatar-uploader.tsx) by
   making the two forms siblings instead of nested. While fixing this,
   `removeAvatarAction` in
   [profile.ts](../src/server/actions/profile.ts) was also hardened: it
   previously swallowed Supabase Storage `list`/`remove` errors, which could
   have let `avatar_path` get cleared in the database while an orphaned file
   remained in Storage with no error shown. It now surfaces storage failures
   to the UI and leaves the database untouched if storage cleanup fails.
   Covered by 8 new tests in
   [profile.test.ts](../src/server/actions/profile.test.ts) and 4 in
   [avatar-uploader.test.tsx](../src/components/profile/avatar-uploader.test.tsx)
   (including a structural assertion that no `<form>` is ever nested inside
   another). **User retested manually and confirmed upload, replacement, and
   removal all work correctly.**
2. **Dev-console Base UI warning**: "A component that acts as a button
   expected a native `<button>`..." repeated across `site-header.tsx` and
   other pages. Cause: several nav/CTA buttons rendered Base UI's `Button`
   primitive as a `next/link` `Link` via the `render` prop
   (`<Button render={<Link .../>}>`), swapping the underlying DOM node for an
   `<a>`. Base UI's own docs are explicit that links shouldn't be routed
   through `Button` this way — a link has its own native semantics `Button`
   would otherwise override. Fixed by adding
   [`LinkButton`](../src/components/common/link-button.tsx), which applies
   the same `buttonVariants` classes directly to a real `Link` instead of
   going through Base UI's `Button` at all. Replaced all 9 affected usages
   across `not-found.tsx`, `page.tsx`, `site-header.tsx` (5) and
   `users/[username]/page.tsx` — confirmed via grep that zero
   `<Button render={<Link .../>}>` usages remain anywhere in the app.
   Covered by 3 new tests in
   [link-button.test.tsx](../src/components/common/link-button.test.tsx),
   including one that spies on `console.error` and asserts the specific
   Base UI warning message never fires.

Full auth architecture, route policy, dashboard configuration, security
notes, and the manual checklist all live in **[docs/AUTH.md](./AUTH.md)** —
read that before touching any auth code. [docs/DATABASE.md](./DATABASE.md)
remains the schema reference.

**`src/lib/igdb/` is no longer a placeholder** — a real, tested
implementation as of this pass (see the Prompt 3 section below and
[docs/IGDB.md](./IGDB.md)). `src/lib/pinecone/` remains a server-only
placeholder — the only Pinecone-adjacent effect anywhere is a `game_vector_sync`
row marked `status: "pending"` on import; no Pinecone call happens yet.
`SUPABASE_SECRET_KEY` is now used in exactly one place beyond `admin.ts`
itself: `src/server/services/game-sync.ts`'s import path (via
`createAdminClient()`) — still never for normal user CRUD, which continues to
run under the user's own session and RLS via `src/lib/supabase/server.ts`.

Git is initialized locally, branch `main`, **zero commits** — nothing is
committed per standing instructions; commit only when explicitly asked. The
Supabase project is CLI-linked; migrations 1–18 are confirmed live (see the
Prompt 3 section above).

**Prompt 4 (core tracking) is implemented.** `user_games` status/rating,
diary entries, spoiler-aware reviews, likes, and comments are all wired
end-to-end: the Server Actions, validation, read services, and every
UI component (rating control, status selector, diary dialog, review
composer, review card, comment thread) were already on disk from an earlier
session; this pass added the three pieces that were missing — `/library`,
`/diary`, and `/reviews/[id]` pages, the paginated read services they need
(`src/server/services/{library,diary}.ts`, `getReviewDetail` in
`src/server/services/reviews.ts`), route protection for the two new
authenticated pages, nav links, a `useActionState`-pending fix on the
rating control, and this prompt's `docs/SOCIAL.md`. **No new database
migration was needed or created** — every mutation is a single-table
statement against tables that have been schema-ready with RLS since
Prompt 1. Full detail: [docs/SOCIAL.md](./SOCIAL.md).

`npm run lint`, `npm run typecheck`, and `npm test` are clean. **The manual
two-user browser checklist (docs/SOCIAL.md's §"Manual two-user checklist")
has not been run** — that is a deliberate, explicitly-flagged gap, not an
oversight, matching the same honesty standard used for the Prompt 3 IGDB
smoke test. See "Next up" below.

The rating histogram is a deliberate scope cut for this prompt, not an
oversight: fetching raw `user_games.rating` rows to bucket a histogram is
subject to PostgREST's default row cap and would silently under-count a
popular game, so the game page shows only `game_rating_stats`' average +
count. A real histogram is a candidate for a future prompt, built as a
proper database aggregate via its own migration.

One structural note worth recording plainly: the original plan for this
prompt called for `src/server/services/{library,diary,reviews}.ts` as
dedicated read services from the start. The four Server Actions files
(`library.ts`, `diary.ts`, `reviews.ts`) ended up calling `supabase.from(...)`
directly instead of delegating reads to a services layer — `game-social.ts`
is the one module that _was_ built as a dedicated service, and the new
`library.ts`/`diary.ts`/`reviews.ts` _services_ added in this pass follow
that same convention for the newly-added `/library`, `/diary`, and
`/reviews/[id]` reads. The mutation-adjacent reads inside the action files
(e.g. `rateGameAction`'s post-update `.select("id")`) were left as-is rather
than retroactively extracted, since touching working, tested code for a
pure structural nit wasn't part of this recovery's scope.

### Regressions found during manual testing and fixed

The user's first manual browser pass against the standalone production
build found two real regressions in the code above. Both are now fixed and
**both were confirmed fixed by a follow-up manual retest** (not just by
automated tests — see below for exactly what the retest covered).

1. **`/diary` redirected to the public profile (`/users/[username]`).**
   Root cause: `src/lib/auth/route-policy.ts`'s `REQUIRES_AUTH_PATHS`/
   `REQUIRES_COMPLETED_PROFILE_PATHS` had `/library`/`/diary` added, but
   `src/lib/supabase/session.ts` maintained its own **separate** hardcoded
   `GATED_PATHS` list (the paths the proxy actually fetches
   `profiles.username`/`onboarding_completed_at` for) that was never
   updated to match. A request to `/diary` skipped the profile lookup
   entirely, `onboardingCompleted` silently defaulted to `false`, and the
   route policy redirected to `/onboarding`; that second request to
   `/onboarding` _is_ gated, fetched the real (completed) profile, and
   redirected again to the public profile — a two-hop redirect chain that
   looked like `/diary` itself sent visitors to their profile. Fixed by
   exporting `GATED_PATHS` from `route-policy.ts` as the single source of
   truth; `session.ts` now imports it instead of duplicating it, so this
   specific class of drift can't recur. New regression tests in
   `session.test.ts` and `route-policy.test.ts`.
2. **`/games/[slug]` crashed for a signed-in viewer with their own review**:
   `Error: Attempted to call starGlyphs() from the server but starGlyphs is
on the client.` Root cause: `starGlyphs` was defined and exported from
   `review-card.tsx` (`"use client"`); `own-review-card.tsx` (a Server
   Component, added in the previous regression-fix pass) imported and
   called it directly — a plain function call across a Client Component
   module boundary, which Next only allows for JSX rendering, not direct
   invocation. `OwnReviewCard` returns early when there's no review yet, so
   this only crashed once a viewer's own review existed — explaining why
   the page "worked at first, then broke." Fixed by moving `starGlyphs`
   into `src/lib/rating.ts` (plain, server-safe, no client dependency);
   both `review-card.tsx` and `own-review-card.tsx` now import it from
   there. New regression tests: `rating.test.ts`, a source-level
   Server/Client boundary check in `own-review-card.test.tsx`, and a new
   `src/app/games/[slug]/page.test.tsx` covering all 5 review states (no
   reviews, another user's review, the viewer's own review, a review
   created then deleted, signed-out rendering).

**Manual retest performed by the user, confirmed passed:**
`/diary` stays on `/diary` and displays the logged play (not a redirect to
the public profile); the Zelda game page renders successfully signed in as
the review's owner; a hard refresh produced no `starGlyphs` Server/Client
Component error; no further regression was observed during these checks.

**Since then, the user has also run the full manual two-user checklist in
[docs/SOCIAL.md](./SOCIAL.md) to completion — every item passed** — and
separately spot-checked `/library` (status tabs, sort, pagination) against
real data, which also passed. Prompt 4's manual verification is complete;
nothing about this feature is still pending. See "Next up" below.

## What's built

**Prompt 0 — Foundation:** Next.js 16.3.0, TypeScript strict, Tailwind v4,
shadcn/ui (neutral, Base UI primitives), dark-first Savepoint theme, env
validation (`src/lib/env.ts` / `env.server.ts`), the three Supabase clients
(`client.ts` / `server.ts` / `admin.ts`), `src/proxy.ts`, `/api/health`,
Vitest + Testing Library, `.gitattributes`/`.gitignore` hardening.

**Prompt 1 — Database:** 16 SQL migrations under `supabase/migrations/`: 17
tables + 3 views + `avatars` storage bucket, RLS on every table,
`SECURITY DEFINER` functions with locked `search_path`, an anti-forgery
trigger design for `activity_events`.

**Prompt 2 — Auth (this pass):**

- `src/proxy.ts` → `src/lib/supabase/session.ts` → `src/lib/auth/route-policy.ts`
  — session refresh via `getUser()` (never a raw cookie/`getSession()`) plus
  route protection: auth-required pages, redirecting signed-in visitors away
  from login/signup, onboarding gating. The decision logic is a pure,
  fully-unit-tested function; `session.ts` is separately tested with
  Supabase mocked.
- `src/server/actions/auth.ts` — sign up, sign in, sign out, forgot
  password, reset password. `src/server/actions/profile.ts` — onboarding
  completion, profile edits, avatar upload/replace/remove.
- Routes: `/login`, `/signup`, `/forgot-password`, `/reset-password`,
  `/auth/callback` (PKCE code-exchange route handler), `/onboarding`,
  `/settings/profile`, `/users/[username]` (public). Route map corrected
  from the earlier `/u/[username]` sketch to `/users/[username]` — see
  ARCHITECTURE.md.
- `src/lib/validation/auth.ts` — every constraint mirrors its DB CHECK
  constraint exactly. `src/lib/rate-limit.ts` — in-memory, single-instance
  limiter on every auth submission + the username-availability endpoint.
  `src/lib/auth/redirect-safety.ts` — open-redirect guard on every `next`
  param.
- `SiteHeader` is now an async Server Component showing sign-in/sign-up vs.
  profile/settings/sign-out based on the session. Landing page's primary
  CTA now points to `/signup`.
- New shadcn primitives: `label`, `textarea`, `alert`, `avatar`.
- `src/components/common/link-button.tsx` — a `next/link` `Link` styled with
  `buttonVariants`, used everywhere a nav/CTA link needs to look like a
  button (see "Bugs found and fixed" above for why this exists instead of
  Base UI's `Button` + `render` prop).

**`src/types/database.ts` is fully, genuinely generated as of this pass** —
Prompt 3's manual patch (added ahead of migration 18 being live, covering
`game_modes`/`themes`/`game_game_modes`/`game_themes` + 7 new `games`
columns) has been superseded: regenerated via
`supabase gen types typescript --linked` against the live post-migration-18
schema and diffed against the hand-patch first — **byte-identical**. The
manual-patch banner is removed; the file is a plain, unmodified generated
output, same as it was at the end of Prompt 2.

**Prompt 3 — IGDB integration, local catalogue, discovery, game detail
(complete):**

- `src/lib/igdb/` — full replacement of the placeholder: Twitch
  client-credentials token cache (`token.ts`), a 4 req/s + 8-concurrent
  request scheduler (`rate-limiter.ts`), a timeout/bounded-retry/typed-error
  request client (`client.ts`), the sole Apicalypse query builder
  (`apicalypse.ts`), name normalization + relevance ranking
  (`normalize.ts`/`ranking.ts`), raw-IGDB-to-DB-row mapping (`mappers.ts`),
  IGDB CDN URL construction (`image-url.ts`), the search wrapper
  (`search.ts`), single-request detail fetch by id/slug (`detail.ts`), and a
  60s search-result cache (`search-cache.ts`). Uses IGDB's **current**
  `game_type`/`websites.type` fields throughout — the deprecated
  `category`/`websites.category` numeric enums are not read anywhere.
- `src/server/services/game-catalogue.ts` (read-only: local-first, IGDB
  fallback, global-ranked merge, pure local paginated discovery — never
  writes) and `game-sync.ts` (the only write path, via
  `src/lib/supabase/admin.ts`; one shared idempotent upsert every import
  path funnels through; the `/games/[slug]` abuse boundary — slug
  validation, a local-only cache check, a per-client rate limit gate that
  only engages when an IGDB call is actually about to happen, graceful
  stale-serve, and a caught `GameImportRateLimitedError` instead of a raw
  error).
- Routes: `/discover`, `/search`, `/games/[slug]` (all public, no login
  required — same as `/users/[username]`), `GET /api/search` (the only
  IGDB-touching browser-facing endpoint; read/merge only, cannot import).
- `⌘K`/`Ctrl+K` search command dialog
  (`src/components/search/search-command-dialog.tsx`), wired into
  `SiteHeader` — real combobox/listbox ARIA semantics layered on top of
  Base UI's `Dialog` (which handles open/close/focus-trap/Escape/focus-return
  on its own).
- New UI primitives: `dialog`, `badge`, `separator`
  (`src/components/ui/`), following the existing thin-CVA-wrapper pattern.
- New game components: `poster-card` (disables `next/link` prefetch for
  not-yet-imported results — otherwise rendering a results list could
  silently trigger imports), `poster-grid`, `igdb-attribution`, `game-hero`,
  `game-metadata` (website links re-validated as http(s) at render time,
  `target="_blank" rel="noopener noreferrer"`; genre/platform/mode/theme
  chips; no community/stats section — that's Prompt 4 territory).
- `supabase/migrations/20260812100000_add_igdb_game_metadata.sql` — new
  reference tables `game_modes`/`themes` + join tables `game_game_modes`/
  `game_themes` (mirroring `genres`/`platforms`/`game_genres`/
  `game_platforms` exactly, RLS + explicit grants), and 7 new nullable
  `games` columns (`igdb_game_type_id`, `igdb_game_type` — no closed CHECK
  enum, since IGDB's type vocabulary isn't fixed — `version_parent_igdb_id`,
  `keywords`, `developer_names`, `publisher_names`, `websites`). **Applied
  and confirmed live** — `supabase migration list` shows local/remote
  matching for all 18 migrations, `verify-schema` passes 44/44.
- Full detail, field-mapping table, ranking algorithm, and security notes:
  **[docs/IGDB.md](./IGDB.md)** (new).

**Prompt 4 — Core tracking (implemented, no new migration):**

- `src/server/actions/{library,diary,reviews}.ts` — Server Actions for
  status/rating changes, diary CRUD, review CRUD, review like toggling, and
  comment CRUD. `toggleReviewLikeAction` validates its raw runtime arguments
  with Zod before any auth check or database call, since it's called
  directly from a client transition rather than via `<form>` FormData.
- `src/server/services/game-social.ts` — the game page's batched, two-tier
  read (viewer's library row, recent diary entries, own review, aggregate
  rating, up to 5 other reviews with hydrated author/like data — never one
  query per review row). `src/server/services/{library,diary}.ts` (new this
  pass) — paginated reads for `/library`/`/diary`, always scoped to a
  server-derived user id. `src/server/services/reviews.ts` (new this pass)
  — `getReviewDetail(reviewId, viewerId?)` for `/reviews/[id]`, viewer id
  optional so a signed-out visit still renders fully.
- `src/lib/validation/{common,library,diary,reviews}.ts` — Zod schemas,
  including a shared FormData→number star-rating preprocessor that rejects
  garbage input instead of silently coercing it to `null`/`0`.
- New components: `star-rating-input` (dual controlled/uncontrolled radio
  group), `rating-control`, `status-selector`, `game-action-panel`,
  `log-diary-entry-dialog`, `review-composer`, `review-card`,
  `comment-composer`/`comment-item`. Review/comment bodies always render via
  `whitespace-pre-wrap` plain text — never `dangerouslySetInnerHTML`.
- Routes: `/games/[slug]` gains the action panel, an aggregate-only rating
  section (no histogram — see below), and a recent-reviews section.
  `/library` and `/diary` (new this pass) — authenticated, current-user-only,
  gated the same way as `/settings/profile`. `/reviews/[id]` (new this
  pass) — public permalink with comments.
- `src/lib/auth/route-policy.ts` — `/library`/`/diary` added to
  `REQUIRES_AUTH_PATHS` and `REQUIRES_COMPLETED_PROFILE_PATHS` this pass.
  `src/components/layout/site-header.tsx` — Library/Diary nav links added
  this pass.
- Full detail, the rating-semantics invariant, the RPC decision, and the
  manual two-user checklist: **[docs/SOCIAL.md](./SOCIAL.md)** (new).

## Known environment quirks (see also docs/ENVIRONMENT.md)

- Project folder `Z:\Savepoint` is a mapped **UNC network share**
  (`\\192.168.1.210\ZimaOS-HD\Savepoint` / `/DATA/Savepoint` on ZimaOS).
  Turbopack cannot resolve the `\\?\UNC\...` path form and fails CSS
  processing, so `npm run dev` / `npm run build` default to `--webpack`.
- Production entrypoint is `node .next/standalone/server.js`, not
  `next start` (this project uses `output: "standalone"`).
- Git reports "dubious ownership" on this UNC path — use a per-invocation
  override, not a persisted config change:
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$(pwd)" git <cmd>`.
- **New this pass:** `/` and `/_not-found` are now server-rendered
  (`ƒ`) rather than static (`○`) — `SiteHeader` reads the session cookie on
  every request to decide what to show, which makes every page dynamic by
  necessity. Expected, not a regression.
- `docs/DATABASE.md`'s original "GRANTs are a second gate" framing needed a
  correction after Prompt 1's live verification (Supabase grants broad
  default privileges; RLS is the real gate) — already fixed there, noted
  here so it isn't rediscovered as a surprise.

## Verification

**Prompt 2** (avatar-removal fix + Base UI Link-button fix): all automated
checks clean at the time, 71/71 tests. Full history retained above.

**Prompt 3, Phase A**: `npm run lint`, `npm run typecheck`, `npm test`
(**142/142** — 71 new: token caching, rate limiting, request client
retry/timeout behavior, name normalization, ranking including the "Legend of
Zelda" worked example and a mixed local+IGDB fairness case, mapper
field-by-field correctness including URL/website capping and allow-listing,
game-sync idempotency and the single-detail-fetch and rate-limit-gate
behaviors, game-catalogue merge/dedupe/fallback behavior, the `/api/search`
route's validation/rate-limiting, `PosterCard`'s prefetch flag, the search
dialog's accessible combobox/listbox semantics, and new `route-policy` cases
locking in that `/discover`/`/search`/`/games/[slug]` are public), all
passed clean against a hand-patched `src/types/database.ts`.

**Prompt 3, Phase B (this pass, after the user confirmed migration 18 is
live)**: `src/types/database.ts` regenerated for real and diffed
byte-identical against the hand-patch; `npm run verify-schema` **44/44**;
`npm run igdb:smoke-test` **6/6** against the real Twitch/IGDB/Supabase
APIs (see "Where things stand" above for the full result and the imported
game's identity). Regenerating the types surfaced one small, non-schema
fix: two of the pure `src/lib/igdb/` files (`mappers.ts`, `ranking.ts`) used
extensionless internal imports that work fine under webpack/tsc but not
under Node's native ESM resolver, which `scripts/igdb-smoke-test.mts` runs
under — fixed by adding explicit `.ts` extensions to those two import
statements (plus `allowImportingTsExtensions: true` in `tsconfig.json`, needed
since `noEmit` is already `true` there). Re-ran `npm run lint`,
`npm run typecheck`, `npm test` (**142/142**), `npm run format:check`, and
`npm run build` (all 16 routes) after that fix — all clean. This was a
tooling/module-resolution fix, not a schema change, so no new migration was
needed or created.

**Prompt 4 (core tracking, this pass — finishing the interrupted session's
remaining pieces)**: `npm run lint` (0 errors, 4 pre-existing-style
`no-unused-vars` warnings on intentionally-unused `_formData` action-mock
parameters, same pattern already used elsewhere in this codebase),
`npm run typecheck` (clean), `npm test` (**260/260**, up from the 84
directly-relevant tests already passing before this pass — 3 new test files
this pass: `game-social.test.ts`, `game-action-panel.test.tsx`,
`log-diary-entry-dialog.test.tsx`, plus extended cases in
`route-policy.test.ts` and a new pending-state pair in
`rating-control.test.tsx`), `npm run format:check` (clean, after running
`npm run format` once to normalize pre-existing drift across ~20 files —
whitespace only, no logic changes), and `npm run build` (all 18 routes,
including the three new ones — `/library`, `/diary`, `/reviews/[id]` —
compiled clean). **The manual two-user browser checklist in
[docs/SOCIAL.md](./SOCIAL.md) has not been run** — only the pieces above
were actually executed and observed in this pass.

**Prompt 4 regression-fix pass (this pass)**: `npm run lint` (0 errors, same
4 pre-existing style warnings), `npm run typecheck` (clean), `npm test`
(**292/292**, 39 files — up from 260/260, the 32 new tests covering both
regressions above), `npm run build` (all 18 routes), and
`npm run verify-standalone` — extended this pass to additionally hit
`/games/the-legend-of-zelda-breath-of-the-wild` (200, confirming the real
standalone RSC compilation succeeds, not just a mocked test) and `/diary`
signed-out (307 to `/login?next=%2Fdiary`, confirming the route is gated at
all). A read-only, publishable-key-only check (never printed `note`
content) confirmed 2 pre-existing `diary_entries` rows for the user's
account — no test data was lost or altered. The user then manually
confirmed both fixes in the browser, and subsequently completed the full
manual two-user checklist in [docs/SOCIAL.md](./SOCIAL.md) (every item
passed) plus the `/library` real-data spot-check (passed) — Prompt 4's
manual verification is complete.

**Still not automated — deliberately manual** (unchanged from Prompt 2):
real email delivery, real PKCE code exchange, real Storage uploads — see
[AUTH.md](./AUTH.md#manual-integration-checklist), already passed.

**Prompt 8 (design/responsive/accessibility pass, this pass)**: `npm run
lint` (0 errors), `npm run typecheck` (clean), `npm test` (**454/454**, 61
files — up from 444), `npm run format:check` (clean), `npm run build`, and
`npm run verify-standalone` all re-run clean after every change in this
pass — full detail under "Prompt 8" above. **The user then personally ran
the full manual browser checklist — every item passed** — and separately
surfaced a semantic-search discoverability gap, fixed with an "Open full
search" link in the ⌘K dialog and 8 new regression tests; all automated
checks re-ran clean afterward (`npm test` **462/462**, 61 files), and **the
user re-verified the fix in the browser — every item passed.** Prompt 8 is
complete; nothing about it is outstanding.

## Next up

**Prompt 4 is complete and closed.** Implemented, automated-checks-clean,
the two regressions found by initial manual testing are fixed and
confirmed, and both remaining verification items are now done:

1. `docs/SOCIAL.md`'s full manual two-user browser checklist (two accounts,
   the complete rate/status/diary/review/like/comment interaction flow) —
   **run in full, every item passed.**
2. `/library` (status tabs, sort, pagination) spot-checked against real
   data — **passed.**

Nothing about Prompt 4 is outstanding.

**Prompt 5 — lists, social & profiles is complete.** Implemented,
automated-checks-clean, and the user has personally run the full live
two-user/one-private-list manual checklist in
[docs/SOCIAL.md](./SOCIAL.md#manual-two-user--one-private-list-checklist) —
**every item passed, no regressions found.** See "Prompt 5 — Phase A",
"Prompt 5 — Phase B", and "Prompt 5 — manual verification" near the top of
this file for the full detail.

Nothing about Prompt 5 is outstanding.

**Prompt 7 — Pinecone semantic search — semantic search half complete and
fully manually verified.** (Prompt 6 — Lists was merged into Prompt 5, see
[ROADMAP.md](./ROADMAP.md).) The user bootstrapped the real index
(`savepoint-games`, namespace `games`, model `llama-text-embed-v2`,
deletion protection enabled), Phase B ran end-to-end against it (read-only
compatibility check, bounded 5-game backfill — 5 synced, 0 failed — and
the three-query smoke test — 15 hits, 0 failures, every hit resolved to a
genuine Supabase row), and the user personally ran the manual browser
checklist — **every item passed.** See "Prompt 7 — Phase A", "Prompt 7 —
Phase B" near the top of this file, and [PINECONE.md](./PINECONE.md) for
full detail.

**Known, expected limitation (confirmed during manual testing, not a
defect)**: semantic search only covers games already imported into
Supabase and synced to Pinecone — currently the 5 backfilled games — not
the wider IGDB catalogue. This is inherent to the approved on-demand
cached-game indexing architecture and the deliberately bounded Phase B
backfill. Lexical search is unaffected.

**Recommendations and reasons, and `recommendation_feedback`, are
explicitly not started** — deferred to a later pass. Nothing else about
the semantic search half of Prompt 7 is outstanding.

**Prompt 8 — design, responsive layout & accessibility pass — complete.**
See "Prompt 8" above for full detail on what changed. Automated checks
were clean throughout; the browser preview tool was unavailable to the
assistant for the implementation session, so the user personally ran the
full manual browser checklist afterward — **every item passed**
(responsive layouts at 360/768/1024/1440px, signed-in/signed-out
navigation, the mobile bottom nav and hamburger drawer, no content
obscured by the bottom bar, no horizontal overflow, keyboard navigation
and focus trapping/Escape/focus-return, star-rating keyboard interaction,
spoiler reveal, form labels/errors/pending states, reduced-motion
behaviour preserving functional drawers/dialogs/progress indicators, and
no new console/hydration errors).

That pass also surfaced one real gap: semantic search had no discoverable
route from the visible navigation. Fixed with an "Open full search" link
in the ⌘K dialog (mentions both Standard and Semantic modes, preserves and
URL-encodes any in-progress query, closes on navigation, Tab-reachable),
covered by 8 new regression tests, all automated checks re-run clean
(**462/462**), and **the user re-verified the fix in the browser — every
item passed** (link visible and clearly labelled, accessible wording
mentions both modes, query preserved/encoded, dialog closes on
navigation, keyboard-only Tab+Enter works, existing Enter-to-open-game
behaviour unchanged, mobile Search nav still reaches `/search`, the
Standard/Semantic toggle is visible with semantic search returning the
currently indexed games, no new console/hydration errors).

Nothing about Prompt 8 is outstanding.

**Prompt 7C — broad IGDB catalogue semantic indexing — Gates A1/A2/B/C
complete.** The migration is applied and live-verified; the full
resumable/checkpointed discovery system, schema v2 record shape,
`igdb_id`-based hydration fix, catalogue-only result rendering with its
POST-based import boundary, and both operator scripts are built and
unit-tested. See "Prompt 7C" above for the full changelog and
[PINECONE.md](./PINECONE.md#broad-catalogue-indexing-prompt-7c) for the
design.

**Gate B** (read-only candidate-count estimate) ran live: Conservative
25,083 / **Balanced 26,676 (chosen)** / Broad 29,237. The Pinecone org
was separately upgraded from Starter to Builder (10M embedding
tokens/month, unchanged 250K/minute passage limit, flat-rate/no-overage)
— reflected in PINECONE.md's quota table.

**Gate C** ran a real, bounded 25-record `balanced` canary — see
[PINECONE.md's Gate C results
table](./PINECONE.md#gate-c-results--balanced-profile-canary-2026-08-12)
for exact numbers (25/25 synced, 0 failures, 0 duplicate `igdb_id`s, all
records confirmed schema v2 live, Pinecone index 9 → 34 records) and the
user's manual browser-verification results (all PASS). Found and fixed
two ceiling-granularity gaps: `discover`/`incremental`/`release-check`
got a `--page-size` flag (a small `--limit` can now be paired with a
matching scan-page size); `sync` got `selectWithinTokenBudget()`
(`src/lib/pinecone/token-budget.ts`), enforcing
`--max-estimated-embedding-tokens` before every upsert instead of only
between batches — the actual gap that let the canary's single 25-record
batch land ~1.8% over its declared token ceiling. Discovery cursor
`discover:balanced:gen1` is paused mid-generation (25 of ~26,676
candidates scanned, resumable) — not completed, by design, since Gate C
is capped at 25.

**Gates D** (a user-approved bounded batch, resuming the same cursor)
**and E** (full background sync) each require their own separate,
explicit approval, same as before. Nothing about Gates A1/A2/B/C is
outstanding.
