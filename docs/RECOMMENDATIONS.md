# Recommendations — personalized games with human-readable reasons

Prompt 9's scope: `/recommendations` ("For You"), a page of personalized game
suggestions drawn from the existing Pinecone catalogue index (Prompt 7C —
26,676-game Balanced profile, fully synced), each with a short, honest,
non-LLM reason grounded in the user's own real signals. Closes out the
"recommendations + reasons, `recommendation_feedback`" line from
[ROADMAP.md](./ROADMAP.md)'s Prompt 7 entry — semantic search itself shipped
in Prompt 7/7C; this pass is the deferred remainder.

No catalogue discovery, no Pinecone bootstrap/bulk upsert, and no bulk
Supabase `games` row creation happen anywhere in this feature — it reads the
existing index exactly as `/search`'s semantic mode does, and imports a
catalogue-only game into `games` only through the same on-demand POST
boundary `/search`/`/discover` already use, and only when a user actually
opens one.

## Schema: `recommendation_feedback` gained `igdb_id`

The table existed since migration 6 but was unused by any application code
before this pass, and had a blocking gap: `game_id uuid not null references
games(id)`. Most Pinecone recommendations have no `games` row (nothing has
imported them yet) — inserting feedback for one was a constraint violation.

Migration `20260813130000_add_igdb_id_to_recommendation_feedback.sql`
(applied and confirmed live) made `igdb_id integer not null check (igdb_id >
0)` the stable, always-present cross-boundary identity, safely: added it
nullable, backfilled every existing row from its `game_id`, raised loudly
(not silently) if any row couldn't be backfilled, then set it `NOT NULL`.
`game_id` was relaxed to nullable — populated only when a real `games` row
already existed at the moment feedback was written, never retroactively
backfilled by a later import. A partial unique index,
`(user_id, igdb_id, event_type) WHERE event_type IN ('saved', 'dismissed',
'completed')`, makes those three event types toggleable (`shown`/`clicked`
stay fully unconstrained — repeated impressions/clicks over time are
expected, not a violation).

## Never trust client-supplied identity

Every recommendations Server Action and API route accepts only a validated
`igdbId` (positive integer) and, where relevant, a validated `eventType`.
None accept `gameId`, `userId`, or a `slug` from the client:

- `user_id` always comes from the authenticated session
  (`requireUser`/`supabase.auth.getUser()`), never a parameter.
- `game_id` is resolved server-side, looking up `games` by the validated
  `igdb_id` — a client can never point an arbitrary `game_id` at a different
  game.
- No action takes a `slug` parameter. Cached results navigate via a real
  `<Link>` built from trusted server-hydrated data; catalogue-only results
  redirect to whatever slug the server-side import itself resolves.

## Signal weighting

`buildUserTasteProfile()` (`src/server/services/recommendations.ts`) reads
`user_games`, `diary_entries`, `reviews`, `review_likes`, and
`recommendation_feedback` (`event_type = 'saved'`), and merges everything
into one weighted signal **per game** — an explicit rating always overrides
a status-derived tier, signals are never summed across sources for the same
game.

| Tier               | Weight | Sources                                                                           |
| ------------------ | ------ | --------------------------------------------------------------------------------- |
| Strong positive    | 3      | rating ≥ 8 (any source), `status = 'completed'`, **"Helpful" (`saved`) feedback** |
| Weak positive      | 1      | `playing`/`wishlist`/`backlog`/`paused` status, a diary entry, rating 4–7         |
| Very weak positive | 0.3    | liking someone else's review of the game                                          |
| Negative           | −2     | rating ≤ 3 (any source), `dropped` status with no rating                          |

**Wishlist/playing/backlog games are hard-excluded from the output list but
still counted as a taste signal** — output eligibility and signal
contribution are deliberately decoupled, so putting a game on the backlog
still teaches the model what you like without ever recommending back
something you've already queued up.

**"Helpful" feedback genuinely feeds back into ranking**, including for a
catalogue-only game the user has never imported: `recommendation_feedback`
rows with `event_type = 'saved'` are read (`created_at desc`, capped at 20),
split by whether they have a `game_id`. Rows that do get their tags from the
normal batched `games`/`genres`/`game_modes` join; rows that don't (the game
was catalogue-only when marked Helpful) get their tags from **one bounded
Pinecone metadata `fetch()`** keyed by `buildCatalogueRecordId(igdbId)` —
never a search, never a write to `games`. If that fetch fails, the affected
signals are silently dropped (no throw) — Helpful feedback degrading
gracefully is preferable to breaking the whole recommendation request over a
transient Pinecone read.

`dismissed`/`completed` feedback are pure exclusions, not taste signals.
`shown`/`clicked` are pure telemetry, also not taste signals.

## Retrieval and ranking

One deterministic, weight-ordered, deduped synthetic query string
(`buildSyntheticQuery()`, capped ~400 chars) goes to one `searchGameHits()`
call, overfetching `CANDIDATE_TOPK = 60` candidates against a
`TARGET_SIZE = 20` page so exclusion filtering rarely leaves a thin result
set. `searchGameHits` (`src/lib/pinecone/search.ts`) is a new, richer query
API returning `genres`/`platforms`/`gameModes` alongside the existing
`igdbId`/`score`/`slug`/`name`/etc. — `searchGameIds` (used by
`semantic-search.ts`, untouched) is now a thin delegator over the same
underlying call, so its return shape and behavior are unchanged.

```
tagScore(hit)      = Σ P[tag] for tag in hit.genres ∪ hit.gameModes − 1.0 · Σ N[tag] for same
finalScore(hit)    = 0.6 · normalize(hit.score) + 0.4 · normalize(tagScore(hit))
```

Both the real Pinecone relevance score and the tag score are independently
min-max normalized (`minMaxNormalize()`) before blending, so neither
assumes a particular score range; an equal-values array (including a
single-candidate array) maps every value to `0.5` rather than dividing by
zero. Ranking never hard-drops a candidate for scoring reasons — the full
eligible set is sorted and truncated to `TARGET_SIZE`; only below
`FULL_RESULT_FLOOR = 12` (and still nonzero) does the page render an honest
"showing fewer than usual" notice instead of silently looking full.

## Exclusions

A candidate is dropped if its `igdb_id`:

- appears in `user_games` under **any** status (this one rule subsumes
  "already rated" and "already completed" — any library entry at all is an
  exclusion),
- has `dismissed` or `completed` feedback,
- was `shown` within the last 60 minutes (`SHOWN_EXCLUSION_WINDOW_MS`) —
  this window doubles as the impression-idempotency window, since a
  legitimate new batch can't structurally contain an id shown moments ago,
- is a duplicate within the candidate set itself.

If every candidate is excluded, `RecommendationsUnavailableError` is thrown
— a genuine "can't produce a page right now," never conflated with a
merely-reduced-but-nonzero result.

## Reasons — deterministic, no LLM, never an unsupportable claim

`generateReason()` is a pure function, same inputs always produce the same
output:

1. If a single strong-signal game (rated highly, marked completed, or
   marked Helpful) shares a tag with the candidate, name it: _"Because you
   rated {name} highly."_
2. Otherwise, cite the top 1–2 aggregate positive tags the candidate shares
   with the user's taste profile: _"Matches your preference for {tag}."_
3. In preference-assisted mode, cite the genre hint directly: _"Matches your
   selected genre: {genre}."_
4. Otherwise, an honest generic fallback — never a fabricated personal
   claim.

## Cold start — three distinct, honestly-labeled modes

`COLD_START_THRESHOLD = 3` positive signals.

| Mode                | Condition                           | Behavior                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold start          | < 3 signals, no genre hints         | Zero Pinecone calls. `ColdStartView`: explains why, links to `/discover`, offers an optional genre picker.                                                                                                                                         |
| Preference-assisted | < 3 signals, valid `?genres=` hints | One non-personalized Pinecone query biased toward the picked genres. Results carry a distinct badge: _"Preference-assisted discovery — based on your genre picks, not yet learned from your activity."_ Never conflated with real personalization. |
| Personalized        | ≥ 3 signals                         | Normal flow; any genre hints in the URL are ignored.                                                                                                                                                                                               |

Genre hints are never persisted anywhere — they exist only as the
`?genres=` query param for that one request/regeneration.

## Feedback — event-type mapping

| UI label           | `event_type` | Effect                                                                                                                                                                                   |
| ------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —                  | `shown`      | Telemetry only. Batched client-side impression tracking (see below).                                                                                                                     |
| —                  | `clicked`    | Telemetry only. Beacon (cached) or same-request (catalogue-only).                                                                                                                        |
| **Helpful**        | `saved`      | Toggle. Never touches `user_games`/`lists` — `recommendation_feedback` only. **Does** feed back into future ranking (the one feedback type that's a real signal, not just an exclusion). |
| **Not interested** | `dismissed`  | Toggle. Feeds the exclusion set.                                                                                                                                                         |
| **Already played** | `completed`  | Toggle. Never mutates `user_games` — recommendation feedback only. Copy makes this explicit: "Won't recommend this again — doesn't change your library."                                 |

`toggleRecommendationFeedbackAction(igdbId, eventType)` — insert, swallowing
a `23505` conflict via the partial unique index (the same pattern
`review_likes` uses); if a row already exists, delete it instead (flip
whichever state is currently active).

## Impressions — client-triggered, partial-overlap-correct

Not written from a Server Component `after()` — that would count
prefetches and aborted renders as real impressions. `RecommendationGrid`
renders `RecommendationImpressionTracker`, a client component that fires
`recordRecommendationImpressionsAction(igdbIds)` once, after real
client-side commit (`useEffect` + a `useRef` guard against Strict Mode's
dev double-invoke). The action queries which of the **specific incoming**
ids already have a recent `shown` row and inserts only the ones that don't
— never an all-or-nothing "does this whole batch look recent" check, which
would wrongly re-skip the genuinely-new portion of a batch that partially
overlaps a previous one (e.g. regenerating and getting 2 repeats + 3 new).

## Click tracking — survives navigation, doesn't block it

**Cached results** (`<Link>` navigation): a plain `onClick`/`onAuxClick`
handler fires `navigator.sendBeacon()` (built to survive page-unload,
unlike a plain `fetch`) — neither handler calls `preventDefault`, so
keyboard activation, ctrl/cmd-click, and middle-click all keep working
exactly as `PosterCard` already implements them. `sendBeacon`'s return
value is always checked: if it's unavailable, or returns `false` (the
browser rejected queuing it), the code falls back to
`fetch(url, {keepalive: true})` in the same call. The whole thing is
wrapped in try/catch — a telemetry failure must never block navigation.

**`POST /api/recommendations/click`** — five checks, in order, before
`recordClick` is ever called:

1. **401** if there's no authenticated session.
2. **403** if `Origin`/`Sec-Fetch-Site` don't indicate same-origin — this
   endpoint's real CSRF defense (cookie-authenticated, no separate CSRF
   token anywhere in this codebase, matching established convention; both
   headers are browser-set and not spoofable by page JS).
3. **415** if the `Content-Type` isn't `application/json`.
4. **413** if the body exceeds 1024 bytes.
5. **400** if `igdbId` fails validation.

**Catalogue-only results**: no beacon — a `<form>` submission is already a
request the browser waits on, no cancellation risk. Instead
`importRecommendedCatalogueGameAction` records the click and performs the
import in the same request (reusing `importGameByIgdbId`, the same
`catalogue-import:` rate-limit bucket as every other catalogue import — no
separate, more generous budget for recommendations), then redirects. A
failed click record never blocks the import.

## Caching and invalidation

Keyed `recommendations:${userId}:${seed}`, 60-second TTL, via a
generic-typed `getCachedSearch<T>`/`setCachedSearch<T>` (generalized this
pass from the previously `GameSearchResult`-only IGDB search cache). A new
`invalidateCacheByPrefix(prefix)` export does an exact-prefix removal —
called after a successful rating, library-status change, review creation,
or feedback toggle, so a fresh signal is reflected on the very next
generation rather than serving a stale page for up to 60 seconds.

## Rate limits

- `recommendations:${clientId}` — page generation, ~15/60s.
- `recommendation-feedback:${userId}` — toggle/click/impression
  mutations, generous (matches `like-toggle:`'s shape); the catalogue-only
  click+import path reuses `catalogue-import:` instead of its own bucket.

## Pinecone unavailability

A genuine Pinecone failure (`PineconeIndexUnavailableError`,
`PineconeSearchError`) or a zero-eligible-candidates outcome
(`RecommendationsUnavailableError`) renders an honest fallback notice with a
link to `/discover` — never a secondary/degraded ranking algorithm, never a
silently-empty page.

## Nav and route gating

`/recommendations` ("For You") requires auth + a completed profile (added to
both `REQUIRES_AUTH_PATHS` and `REQUIRES_COMPLETED_PROFILE_PATHS` in
`route-policy.ts`), same as `/library`/`/diary`/`/home`. Linked from the
desktop header (between Home and Library) and the mobile nav drawer's
authenticated section. The fixed 5-tab `MobileNavBar` was deliberately left
unchanged — adding a 6th destination there is a bigger nav-structure
decision than this feature warrants on its own.

## Manual two-user browser checklist

**Status: PASS — completed by the user (2026-08-14).** Confirmed:
personalized recommendations load independently for both users;
recommendation reasons render correctly; excluded/already-owned games
behave as documented; recommendation feedback, dismissal, and navigation
all behave correctly; reloading preserves the expected state; no
unexpected browser-console errors appeared. Original checklist below, for
reference:

- Cached and catalogue-only recommendations both render, each with a
  reason grounded in a real signal.
- A catalogue-only card never creates a `games` row from mere display or
  from Not-interested/Already-played — only an actual import click does.
- Impressions/clicks are recorded only after real render / an actual
  click, survive a same-tab navigation, and a partially-repeated
  regenerate batch inserts only the genuinely-new ids.
- "Helpful"/"Already played" visibly do not touch the library or diary.
- Regenerating avoids recently-shown repeats within the session.
- All three cold-start modes render distinctly and are visually honest
  about which one is active.
- User B has zero visibility into User A's recommendations, feedback, or
  cache entries.
