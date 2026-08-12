# IGDB integration

How Savepoint talks to IGDB (via Twitch), caches game data in Supabase, and
serves discovery/search/game-detail pages. Read this before touching
`src/lib/igdb/`, `src/server/services/game-*.ts`, or any `/discover`,
`/search`, `/games/[slug]` code.

## Architecture

| File                                    | Responsibility                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/igdb/types.ts`                 | Raw IGDB response shapes + the normalized `GameSearchResult`/`IgdbGameDetail` types used everywhere else.                                                                                |
| `src/lib/igdb/token.ts`                 | Twitch client-credentials flow, in-memory token cache. **`server-only`.**                                                                                                                |
| `src/lib/igdb/rate-limiter.ts`          | Process-wide 4 req/s + 8-concurrent request scheduler. **`server-only`.**                                                                                                                |
| `src/lib/igdb/client.ts`                | Low-level `igdbRequest()` — timeout, bounded retry, typed errors. **`server-only`.**                                                                                                     |
| `src/lib/igdb/apicalypse.ts`            | The only place an Apicalypse query string is built. Pure — no secrets.                                                                                                                   |
| `src/lib/igdb/normalize.ts`             | Name normalization for matching/ranking. Pure.                                                                                                                                           |
| `src/lib/igdb/ranking.ts`               | Type exclusion + relevance ranking. Pure.                                                                                                                                                |
| `src/lib/igdb/mappers.ts`               | Raw IGDB JSON → DB-ready rows / search results. Pure.                                                                                                                                    |
| `src/lib/igdb/image-url.ts`             | IGDB CDN URL construction. Pure, safe for Client Components.                                                                                                                             |
| `src/lib/igdb/search.ts`                | `searchIgdbGames()` — validates, queries, filters, ranks. **`server-only`.**                                                                                                             |
| `src/lib/igdb/detail.ts`                | `fetchIgdbGameByIgdbId()` / `fetchIgdbGameBySlug()` — one request each. **`server-only`.**                                                                                               |
| `src/lib/igdb/search-cache.ts`          | 60s in-memory search-result cache. **`server-only`.**                                                                                                                                    |
| `src/server/services/game-catalogue.ts` | Read-only: local search, IGDB fallback, discovery listing. Never writes.                                                                                                                 |
| `src/server/services/game-sync.ts`      | The only write path — imports via the admin (secret-key) client, plus the `/games/[slug]` abuse boundary.                                                                                |
| `src/lib/igdb/catalogue-profile.ts`     | Prompt 7C: catalogue-profile `where`-clause builders + client-side eligibility predicate. Pure, not `server-only` — see [PINECONE.md](./PINECONE.md#broad-catalogue-indexing-prompt-7c). |

**Why four of these files are deliberately _not_ `server-only`** (`apicalypse.ts`,
`normalize.ts`, `ranking.ts`, `mappers.ts`): they're pure functions with zero
secrets and zero network access. Keeping them free of the `server-only` guard
lets `scripts/igdb-smoke-test.mts` — a plain Node script that runs outside
Next's bundler, where `server-only` throws unconditionally on import — reuse
the _real_ query-building/mapping/ranking logic instead of a duplicated copy.
Everything that actually touches `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` or
makes a network call stays `server-only`.

## Data flow

**Search** (`/search` page, and the ⌘K command dialog via `GET /api/search`):
`game-catalogue.searchGames()` queries Supabase (`games` table, trigram
index) first. If local results are thin (< 5), it also calls
`igdb/search.ts`, dedupes the two sets by `igdb_id` (keeping the local
representation for its real internal slug), and ranks the _merged_ set with
one algorithm — see [Search quality & ranking](#search-quality--ranking).
**This path never writes anything.** A game only enters the local cache when
someone opens it.

**Detail + import** (`/games/[slug]`): `game-sync.getOrImportGameBySlug()` —
see [Local catalogue & import](#local-catalogue--import) for the full,
security-relevant flow. This is the _only_ way a game gets imported.

**Discovery** (`/discover`): `game-catalogue.listDiscoverGames()` — pure
local, paginated, no IGDB involved at all.

## Rate limiting & caching strategy

- **Global IGDB budget**: `rate-limiter.ts`'s `igdbRateLimiter` paces all
  outbound IGDB requests to at most 4/s with at most 8 concurrent in flight —
  a single process-wide scheduler, appropriate for one Node.js instance (not
  a distributed limiter).
- **`client.ts`**: 8s timeout per request (`AbortController`), bounded
  retries (max 3 attempts total, exponential backoff + jitter) only on `429`
  and `5xx` — never on other `4xx`.
- **Search cache**: `search-cache.ts` holds ranked results per normalized
  query for 60s (capped at ~200 entries), so repeated/trending searches
  don't re-hit IGDB.
- **Game-detail freshness**: a cached `games` row is considered fresh for 14
  days (`REFRESH_TTL_MS` in `game-sync.ts`); past that, the next open
  triggers a re-fetch + re-upsert (idempotent — see below).
- **No bulk copying**: nothing ever iterates or mirrors IGDB's catalogue.
  Every IGDB call is triggered by a real search or a real explicit game
  open.

## Field mapping

IGDB's `category`/`websites.category` fields are **deprecated** and
deliberately not used anywhere in this project. Current fields only:

| IGDB field(s) (dot-expanded in one request)                   | `games` column                                                                                                           | Notes                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                          | `igdb_id`                                                                                                                | Unique, upserted on conflict.                                                                                                                                                                                |
| `name`, `slug`                                                | `name`, `slug`                                                                                                           |                                                                                                                                                                                                              |
| `summary`, `storyline`                                        | `summary`, `storyline`                                                                                                   |                                                                                                                                                                                                              |
| `first_release_date` (unix)                                   | `release_date` (date)                                                                                                    |                                                                                                                                                                                                              |
| `cover.image_id`                                              | `cover_image_id`                                                                                                         |                                                                                                                                                                                                              |
| `screenshots.image_id`, `artworks.image_id`                   | `screenshot_image_ids`, `artwork_image_ids`                                                                              | Capped at 8 each.                                                                                                                                                                                            |
| `genres`, `platforms`, `game_modes`, `themes`                 | `genres`/`platforms`/`game_modes`/`themes` tables + `game_genres`/`game_platforms`/`game_game_modes`/`game_themes` joins | IGDB's own numeric id reused as PK.                                                                                                                                                                          |
| `keywords.name`                                               | `keywords text[]`                                                                                                        | Capped at 10 — selected, not exhaustive.                                                                                                                                                                     |
| `involved_companies.company.name` + `.developer`/`.publisher` | `developer_names text[]`, `publisher_names text[]`                                                                       | Split by the boolean flags, capped at 10 each. No companies reference table (no company browse page).                                                                                                        |
| `rating`, `rating_count`                                      | `igdb_rating`, `igdb_rating_count`                                                                                       | IGDB's community score.                                                                                                                                                                                      |
| `aggregated_rating`, `aggregated_rating_count`                | `igdb_aggregated_rating`, `igdb_aggregated_rating_count`                                                                 | IGDB's critic score.                                                                                                                                                                                         |
| `websites.url`, `websites.type.type`                          | `websites jsonb` (`{type, url}[]`)                                                                                       | Allow-listed types only (see below), capped at 8, http(s)-only URLs.                                                                                                                                         |
| `game_type.id`, `game_type.type`                              | `igdb_game_type_id`, `igdb_game_type`                                                                                    | Current replacement for the deprecated `category` enum — a live, data-driven reference (`game_types` endpoint), **not** a closed set — no CHECK enum on this column.                                         |
| `version_parent`                                              | `version_parent_igdb_id`                                                                                                 | No FK (the parent may never be imported). Ranking/suppression only.                                                                                                                                          |
| `updated_at` (unix, Prompt 7C)                                | _(not persisted to `games`)_                                                                                             | Added to `DETAIL_FIELDS` for the catalogue sync's incremental-discovery watermark (see [PINECONE.md](./PINECONE.md#broad-catalogue-indexing-prompt-7c)) — the on-demand cache path doesn't otherwise use it. |

**Website type allow-list** (matched case-insensitively against
`websites.type.type`, everything else dropped before it's ever persisted):
`official`, `steam`, `gog`, `epicgames`, `wikipedia`, `twitter`/`x`.

**Image size tokens** (`igdbImageUrl(imageId, size)`): `cover_big` for
posters, `1080p` for the game-detail hero backdrop, `thumb` for the search
dialog's small result thumbnails.

**No raw payloads stored** — only the specific fields above. `websites`'s
small, curated, capped JSON array is the one exception, and it's still tiny
and allow-listed, not a raw IGDB response dump.

## Search quality & ranking

**Type exclusion** (app-side, using real returned `game_type.type` data —
never the deprecated `category` enum): `bundle`, `mod`, and `pack` results
are dropped before ranking. DLC/expansion/remaster/port/episode/season stay
in-band, differentiated by rank instead.

**`normalizeGameName`**: lowercase → NFKD + strip diacritics → punctuation →
spaces → collapse whitespace → trim.

**`rankSearchResults`** — stable sort by:

1. Match tier: `0` exact normalized match, `1` prefix, `2` whole-word
   substring, `3` everything else.
2. Version penalty: editions (`version_parent` set) rank below their
   canonical game.
3. Type penalty: `main_game` best, then remake/remaster/port/expanded_game,
   then standalone_expansion, then DLC/expansion/episode/season, then
   anything unrecognized.
4. Original order (tiebreak).

This is the **same algorithm** for raw IGDB results and the local+IGDB
merged set in `game-catalogue.searchGames` — a weak local match can never
outrank a strong IGDB match, or vice versa.

**Worked example — "The Legend of Zelda"**: the canonical 1986 title ranks
first (exact match). _Breath of the Wild_/_Ocarina of Time_ rank next
(prefix match, `main_game` type). A `mod`-type entry never reaches ranking
at all (excluded upstream); if a mistagged edition-like entry ever slipped
through, its type penalty sinks it below every real title at the same match
tier. An unrelated title like _Zelda's Adventure_ falls to the weakest tier
and sorts last.

## Catalogue-scan query building (Prompt 7C)

Three new `apicalypse.ts` builders, alongside the original three
(`buildSearchQuery`/`buildDetailQuery`/`buildDetailBySlugQuery`), for the
broad catalogue sync (`scripts/igdb-catalogue-sync.mts`,
`scripts/igdb-catalogue-estimate.mts`) — see
[PINECONE.md](./PINECONE.md#broad-catalogue-indexing-prompt-7c) for the
full discover/incremental/release-check design these support:

- `buildCatalogueScanQuery({whereClause, sort, limit})` — a lightweight
  field set (`CATALOGUE_SCAN_FIELDS`: id, game_type, first_release_date,
  cover, summary, storyline, total_rating_count, updated_at) for paging
  through up to 500 candidates at once — deliberately not the full
  `DETAIL_FIELDS` list, since a scan page only needs enough to evaluate
  eligibility, not to build a Pinecone record.
- `buildCatalogueCountQuery(whereClause)` — IGDB's `/count` endpoint,
  used by the Gate B estimator.
- `buildCatalogueDetailBatchQuery(igdbIds)` — batches up to
  `CATALOGUE_DETAIL_BATCH_LIMIT` (200) ids into one `DETAIL_FIELDS`
  request, reusing the exact same `mapIgdbGameToRow` path the on-demand
  import already trusts, for the `sync` step's actual record-building.

Same trust boundary as `buildSearchQuery`'s validated search string:
`whereClause` is never user input — it's always built by
`catalogue-profile.ts` from fixed templates with only validated numeric
ids/timestamps interpolated, never from an HTTP request.

## Local catalogue & import

**Cache-first, explicit-open-triggers-import**: `game-catalogue.ts` never
writes. Only `game-sync.getOrImportGameBySlug()` — called exclusively from
`/games/[slug]`'s page render — can trigger an import. Rendering a search
results list, even one containing not-yet-imported IGDB-only results, never
imports anything.

**The `/games/[slug]` abuse boundary** (a public GET could otherwise be used
to burn the IGDB rate budget or hammer the admin write path):

1. The slug is validated (`gameSlugSchema`, matches IGDB's own slug shape)
   before any lookup — invalid → immediate 404, zero calls.
2. `findCachedGameBySlug()` is a local-only read. A fresh cache hit costs
   nothing — no rate limiter touched, no IGDB call.
3. Only when an IGDB call is actually about to happen (true miss, or a stale
   row past the 14-day TTL) does `getOrImportGameBySlug` consume a
   **per-client** rate-limit bucket (`checkRateLimit`, 8/60s per
   `getClientIdentifier()`) — a different, per-caller limiter from the
   global IGDB scheduler.
4. Rate-limited with a stale row already cached → serve the stale row
   (graceful degradation, not a failure).
5. Rate-limited with nothing cached → throws `GameImportRateLimitedError`,
   which the page catches and renders a calm "try again shortly" message —
   never a raw error.
6. `PosterCard`/search-result links to not-yet-imported (`source: "igdb"`)
   games pass `prefetch={false}` — Next's default link prefetching would
   otherwise trigger an import just from a results list rendering on
   screen, with no click at all.

**Idempotent upsert** (`game-sync.upsertGameFromIgdbDetail`) — the _one_
function every import path funnels through:

- Reference rows (genres/platforms/game_modes/themes) upsert on their own
  IGDB-native `id`.
- The `games` row upserts on `igdb_id` (unique) — this is what makes a
  second import structurally incapable of creating a second row; the same
  internal `uuid id` is preserved across re-imports since everything else
  FKs to it.
- Join-table rows are replaced (delete-then-insert, scoped to the game) so a
  re-import correctly reflects any reclassification since the last sync —
  cheap, since there are only ever a handful of rows per game.
- A `game_vector_sync` row is upserted with `status: "pending"` —
  this is the entire "queue for Pinecone sync" mechanism for now. No
  Pinecone call happens; that's the Pinecone milestone's job to drain this
  queue.
- A slug-based import (`importGameBySlug`) fetches IGDB detail **exactly
  once** and passes the already-fetched, already-mapped detail directly into
  the shared upsert — it never fetches by slug and then separately re-fetches
  by id.

## Security

- `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` are read only in `token.ts`/`client.ts`
  (both `server-only`) via `src/lib/env.server.ts`. Never sent to the
  browser, never logged, never included in a thrown error message.
- The Twitch access token is cached in memory only (`token.ts`), refreshed
  ~60s before expiry, never persisted, never logged.
- No generic IGDB proxy and no unrestricted admin import endpoint exist.
  `GET /api/search` is the only IGDB-touching browser-facing endpoint, and it
  only ever calls `game-catalogue.searchGames` (read + merge — cannot
  import). `apicalypse.ts` is the only place an Apicalypse query string is
  ever built, from a fixed field list; the only interpolated values are a
  validated/capped search string, a validated slug, or a numeric id/limit.
- All writes to `games`/`genres`/`platforms`/`game_modes`/`themes`/join
  tables go through `src/lib/supabase/admin.ts` (secret key, bypasses RLS) —
  never a normal user session. RLS on these tables grants `anon`/`authenticated`
  SELECT only (see `docs/DATABASE.md`).
- Website URLs are validated as `http:`/`https:` twice — once at mapping
  time (`mappers.ts`, before ever being persisted) and again defensively at
  render time (`game-metadata.tsx`) — before ever being rendered as a link,
  with `target="_blank" rel="noopener noreferrer"`.

## Manual verification

`npm run igdb:smoke-test` — an opt-in, live, real-network script (never part
of `npm test`), following `scripts/verify-schema.mts`'s conventions: loads
`.env.local` with a graceful fallback, never prints a secret/token value,
prints a PASS/FAIL summary table. It:

1. Obtains a real Twitch token.
2. Searches IGDB for a stable, well-known title and confirms the canonical
   result ranks at the top.
3. Fetches full detail for that game.
4. Imports it into the live Supabase project (a real write, via the secret
   key).
5. Imports it **again** and confirms the row count is still exactly 1 —
   directly verifying "importing twice doesn't duplicate" against the real
   database.
6. Prints the imported game's identity (name/`igdb_id`/slug) and the exact
   cleanup SQL (`delete from games where igdb_id = <id>;`, which cascades to
   every join table + `game_vector_sync`). **It never auto-deletes** —
   cleanup is a manual, deliberate choice.

## Testing

Unit/component tests (mocked, part of `npm test`):
`src/lib/igdb/token.test.ts`, `rate-limiter.test.ts`, `client.test.ts`,
`normalize.test.ts`, `ranking.test.ts`, `mappers.test.ts`;
`src/server/services/game-sync.test.ts`, `game-catalogue.test.ts`;
`src/app/api/search/route.test.ts`;
`src/components/games/poster-card.test.tsx`;
`src/components/search/search-command-dialog.test.tsx`;
`src/lib/auth/route-policy.test.ts` (public-route cases). Prompt 7C adds
`src/lib/igdb/catalogue-profile.test.ts` (profile filter construction,
game_type resolution, agreement between the server-side and client-side
filter representations) and `src/lib/pinecone/catalogue-page-key.test.ts`
(deterministic idempotency-key construction). All network calls are
mocked (`vi.stubGlobal("fetch", ...)`); no live keys are used.
`npm run igdb:smoke-test` and `npm run catalogue:checkpoint-smoke-test`
are the only things that touch the real network, and they're deliberately
separate, opt-in scripts.
