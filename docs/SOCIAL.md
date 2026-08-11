# Core tracking, lists, social, discovery

Covers both Prompt 4 (library/diary/reviews/likes/comments, below) and
Prompt 5 (lists, follows, activity feed, complete profiles, discovery — see
["Prompt 5 — Lists, social & discovery"](#prompt-5--lists-social--discovery)
near the end of this file).

## Prompt 4: library, diary, reviews, likes, comments

Prompt 4: `user_games` status + rating, a diary, spoiler-aware reviews, and
the like/comment layer on top of reviews. Read this alongside
[DATABASE.md](./DATABASE.md) (exact schema/RLS for the five tables below and
the two aggregate views) and [ARCHITECTURE.md](./ARCHITECTURE.md) (route
map). No new migration was needed for this prompt — every table here has
been schema-ready with RLS since Prompt 1.

## Architecture

Every mutation in this prompt is a single atomic single-table statement
(insert/update/delete/upsert) under RLS, using the session-scoped Supabase
client (`src/lib/supabase/server.ts`) — never `admin.ts`. No client-callable
RPC exists anywhere in this schema; see "The RPC decision" below for the one
case that looked like it might need one.

**Reads vs. writes.** Writes live in `src/server/actions/{library,diary,
reviews}.ts` as `"use server"` Server Actions, each following
`profile.ts`'s established skeleton: re-check auth first (defensive, even
behind a gated page), Zod `safeParse` before any database call, mutate via
the session client, map Postgres errors to friendly messages, `revalidatePath`,
return `{status: "success"|"error"}`. Reads live in
`src/server/services/{library,diary,reviews,game-social}.ts`, mirroring
`game-catalogue.ts`'s pagination/batching conventions — `game-social.ts`
(the game page's action-panel + ratings + recent-reviews data) was built this
way from the start; `library.ts`/`diary.ts`/`reviews.ts` (the paginated
`/library`, `/diary`, and `/reviews/[id]` reads) were added afterward, once
the pages that needed them existed, following the same pattern.

**Current-user-only pages.** `/library` and `/diary` are personal,
authenticated pages — each page derives the viewer's id server-side via
`supabase.auth.getUser()` and passes only that id into its read service.
Neither page accepts a user id from `searchParams`, form data, or any other
client-controlled input; `?status=`/`?sort=`/`?page=` are the only query
params they read, and none of them double as an identity parameter.

**`/reviews/[id]` stays public.** `getReviewDetail(reviewId, viewerId?)`
takes an _optional_ viewer id — the review, game, author, like count, and
comments are all public per RLS and are fetched unconditionally; only the
viewer's-own-like lookup is conditioned on a signed-in viewer. A signed-out
visit renders the full page, just without a "you liked this" state or a like
button.

## 1. Schema, RLS, and grants this prompt writes to (confirmed live since Prompt 1, unchanged)

| Table             | Key constraints                                                                                                               | Client INSERT columns                         | Client UPDATE columns                                  | Notes                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `user_games`      | `unique(user_id, game_id)`; `status check in (...)`; `rating check between 1 and 10` (nullable); `game_id on delete restrict` | `game_id, status, rating`                     | `status, rating`                                       | Activity trigger auto-logs `game_rated`/`game_completed`.                            |
| `diary_entries`   | no unique — multiple rows per user/game allowed (replays); `rating` nullable 1–10; `note` nullable ≤2000 chars                | `game_id, played_on, rating, is_replay, note` | `played_on, rating, is_replay, note` (never `game_id`) | Activity trigger auto-logs `diary_entry_logged`. **Publicly readable**, not private. |
| `reviews`         | `unique(user_id, game_id)` — at most one primary review; `rating` **not null**, 1–10; `body` 1–10000 chars                    | `game_id, rating, body, has_spoilers`         | `rating, body, has_spoilers` (never `game_id`)         | Activity trigger auto-logs `review_published` (INSERT only).                         |
| `review_likes`    | composite PK `(user_id, review_id)` — binary, no UPDATE grant/policy at all                                                   | `review_id`                                   | —                                                      | No activity trigger.                                                                 |
| `review_comments` | `body` 1–2000 chars (a distinct cap from reviews' 10000)                                                                      | `review_id, body`                             | `body`                                                 | No activity trigger.                                                                 |

Two read-only aggregate views (`security_invoker = true`, `select` granted to
`anon, authenticated`):

- `game_rating_stats(game_id, average_rating, rating_count)` — sourced from
  `user_games.rating`, not `reviews.rating`. The one source of the game
  page's aggregate score.
- `review_like_counts(review_id, like_count)`.

### Rating semantics — one canonical rating, two independent snapshots

`user_games.rating` is the **one canonical, current rating** for a game in a
user's library, and the **only** input to `game_rating_stats`/the community
aggregate score. `diary_entries.rating` and `reviews.rating` are
**independent, point-in-time snapshots** — "what I rated it when I logged
this playthrough" / "what I rated it when I wrote this review" — and **must
never silently write to `user_games.rating`**. No Server Action in the diary
or review modules ever touches `user_games`; this is enforced by
construction (each action only ever calls `.from()` on its own table) and
locked in by tests asserting `logDiaryEntryAction`, `updateDiaryEntryAction`,
`createReviewAction`, and `updateReviewAction` never call
`.from("user_games")`.

UI copy consequence, applied throughout: the library rating control
(`RatingControl`, writing `user_games.rating`) is labeled **"Your rating"**
and is the one control that drives the aggregate score everyone sees; the
diary dialog's rating field is labeled **"Rating for this playthrough
(optional)"**; the review composer's rating field is labeled **"Your rating
for this review"** with a helper line distinguishing it from the library
rating. **Editing or deleting a review never changes the aggregate score.**

### No rating histogram in this prompt

Fetching raw `user_games.rating` rows to bucket a histogram is deliberately
not done — PostgREST's default row cap means a popular game's rating rows
could be silently truncated, producing a quietly wrong distribution with no
error. The game page shows only `game_rating_stats`' `average_rating`/
`rating_count` (a small, single aggregated row — no cap risk). A real
per-value histogram is a candidate for a future prompt, built as a proper
database aggregate introduced via its own migration, not a raw row fetch.

`src/lib/rating.ts` is the single source of the 1–10 ↔ 0.5–5★ conversion —
`dbRatingSchema`, `starRatingSchema`, `ratingToStars`, `starsToRating`, plus
`averageRatingToStars(average)` (a plain divide by 2, no schema validation —
`game_rating_stats.average_rating` is a rounded decimal like `7.34`, not one
of the 10 valid discrete integers `dbRatingSchema` enforces).

`diary_entries.note` is **public**, not private — the RLS SELECT policy is
`to anon, authenticated using (true)`, identical to every other row in this
schema. It is called a "diary note," never a "private diary note," anywhere
in code, copy, or docs — `LogDiaryEntryDialog` shows an explicit "Visible to
anyone who views your diary or this game — not private." helper line.

## 2. The RPC decision

No new `SECURITY DEFINER`/RPC function was added. The one case that looked
like it might need one — rating a game with no `user_games` row yet — is
resolved architecturally instead: **the rating control is disabled until a
`user_games` row exists** (i.e., until a status has been picked).
`rateGameAction` is therefore a plain `UPDATE ... WHERE user_id = me AND
game_id = X`, never an upsert; zero rows affected (the row was removed
between page load and submit) returns a friendly "Add this game to your
library before rating it" error rather than guessing a default status.
Diary entries and reviews have no FK to `user_games` at all, so logging a
diary entry or writing a review never requires a library row first, by
schema design.

## Pages and routes

| Route           | Auth                         | Purpose                                                                                                                                  |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/games/[slug]` | public                       | Adds the action panel (status/rating/log-play/review), aggregate rating, and up to 5 recent reviews on top of Prompt 3's read-only page. |
| `/library`      | required + completed profile | Current user's library — status tabs, sort (`updated`/`rating_desc`/`alpha`), pagination.                                                |
| `/diary`        | required + completed profile | Current user's diary — paginated, newest play first, row-level edit/delete.                                                              |
| `/reviews/[id]` | public                       | A single review permalink — full body, like/unlike (signed in), comment thread + composer.                                               |

`/library` and `/diary` join `/settings/profile` as the app's
identity-bound personal pages — gated the same way (`src/lib/auth/
route-policy.ts`'s `REQUIRES_AUTH_PATHS` and
`REQUIRES_COMPLETED_PROFILE_PATHS`).

## Manual two-user checklist

**Run in full — every item below passed.** An initial manual pass against
the standalone production build surfaced two real regressions (`/diary`
misrouting, and a `/games/[slug]` Server/Client Component crash in the
owner-review state); both were root-caused, fixed, and manually confirmed
fixed (full detail in
[PROJECT_STATE.md](./PROJECT_STATE.md#regressions-found-during-manual-testing-and-fixed)).
After those fixes, the full checklist below was run to completion (two
accounts) and passed end to end, and `/library` (status tabs, sort,
pagination) was separately spot-checked against real data and also passed.
Prompt 4's manual verification is complete.

1. User A opens a game with no prior activity: action panel shows only the
   status selector (rating control disabled with helper text, diary/review
   entry points still enabled).
2. User A sets status "Playing" → panel updates, rating control becomes
   enabled.
3. User A rates it 3.5★ ("Your rating") → stars render correctly, `/library`
   ("Playing" tab) shows 3.5★, aggregate score on the game page becomes
   3.5★ from 1 rating.
4. User A changes status from "Playing" to "Completed" → status updates,
   the 3.5★ rating is unchanged (confirms `setGameStatusAction` never
   touches `rating`).
5. User A clicks "Clear" on the rating → rating removed, status unchanged,
   aggregate score on the game page drops back to "no ratings yet."
6. User A logs a diary entry (yesterday's date, 4★ for this playthrough —
   independent snapshot, does not change the library rating from step 5's
   cleared state — replay checked, adds a diary note) → appears on
   `/diary`; the note field is visibly labeled as public, not private.
7. User A writes a review (rating required, spoiler-flagged body, checks
   "Contains spoilers") → appears on the game page as A's own review,
   spoiler badge shown, body visible to A without a reveal click. This
   review's rating is independent of A's library rating and does not
   set/change it.
8. User A tries to write a second review for the same game (e.g. a stale
   tab / resubmitted form) → friendly "you already have a review — edit it
   instead" message, no duplicate row.
9. User B opens the same game page signed out first: sees the "sign in to
   track this game" prompt instead of the panel; sees the aggregate score
   only (average + count — no histogram); sees A's review in "recent
   reviews" with the body hidden behind a spoiler-reveal button.
10. User B signs in, returns to the game page, clicks the spoiler reveal
    button → body appears; reload the page → reveal state resets (not
    persisted).
11. User B likes A's review → like count increments immediately
    (optimistic), persists after reload.
12. User B double-clicks the like button rapidly (simulate a race) → no
    error surfaces, final state is a single like, no duplicate
    `review_likes` row.
13. User B unlikes → count decrements; reload confirms persisted.
14. User B comments on A's review, including a line break and some literal
    `<b>test</b>`-looking text → comment appears as plain text with the
    line break preserved and the angle brackets shown literally, never
    rendered as HTML. User B edits their own comment → updates in place;
    User B deletes it → removed.
15. User A visits `/reviews/[id]` for their own review directly → sees an
    "Edit on game page" control (not a second composer), current like
    count.
16. User A edits the review (changes the review's own rating and body,
    unchecks spoilers) → game page and `/reviews/[id]` both reflect the
    change. The game's aggregate score does **not** change from this edit.
17. User A re-rates their library copy ("Your rating", not the review) to
    5★ → _now_ the aggregate score updates.
18. User A removes the game from their library (status selector's Remove,
    with confirmation) → `/library` no longer lists it, but User A's diary
    entry and review both still exist and are still visible on the game
    page and `/diary`.
19. User A deletes their review → redirected to the game page, review gone
    from "recent reviews", `/reviews/[id]` for that id now 404s.
20. Unauthenticated visitor hits `/library` and `/diary` directly →
    redirected to `/login?next=...`; after signing in, lands back on the
    originally requested page.
21. A user with an incomplete profile (mid-onboarding) tries `/library`/
    `/diary` → redirected to `/onboarding`.

---

## Prompt 5 — Lists, social & discovery

Lists (CRUD, public/unlisted/private visibility, ranked/unranked, reordering,
per-item notes), follows, an `activity_events` home feed, complete profile
pages, and discovery (user search, popular public lists, recent public
reviews). Combines what the original roadmap sketched as two separate
milestones — "Graph & feed" and "Lists" — into one; see
[ROADMAP.md](./ROADMAP.md).

The schema for `lists`/`list_items`/`follows`/`activity_events` (tables,
RLS, and the `fn_log_list_activity()`/`fn_log_follow_activity()` triggers)
has been live since Prompt 1 — confirmed by reading the applied migration
SQL directly. Only one new migration was needed:
[migration 19](./DATABASE.md#migration-files-applied-in-order) — two
`security_invoker` views and one `security invoker` reorder function. See
DATABASE.md for its full detail.

### Architecture

Same conventions as Prompt 4 throughout: Server Actions
(`src/server/actions/{lists,follows}.ts`) re-check auth, `Zod.safeParse`
before any database call, mutate via the session client (never `admin.ts`,
except `addListItemAction`'s use of the existing `importGameByIgdbId()` for
an uncached IGDB game — the same non-normal-CRUD admin-client use already
established in Prompt 3), map Postgres errors to friendly messages,
`revalidatePath`. Read services
(`src/server/services/{lists,follows,activity-feed,discovery,profile}.ts`)
take a nullable `viewerId` passed in by the caller — never derived inside
the service — and use the ordinary session client throughout, since every
public surface here (`/users/[username]`, `/lists/[id]` for public/unlisted)
must render fully for a signed-out visitor.

**`viewerId` is not a security boundary inside these services** — RLS on
the request-scoped session client is the actual gate, automatically scoped
to whichever real session (or none) the request carries. `viewerId` is only
used to decide view-model details (an `isOwner` flag, whether to apply an
extra application-level visibility narrowing — see next section, or which
viewer-scoped queries to even run).

### Visibility: RLS plus one application-level narrowing

`lists` RLS already fully gates `private` (owner-only) — a non-owner's
request for a private list returns no row, full stop, and every read
service here treats that as not-found, never as an error. `unlisted` is
different: it's RLS-_readable_ by anyone with the id/link (the documented
"reachable but not discoverable" design from Prompt 1), so every
browse/discovery-style query in this prompt adds an explicit
`.eq("visibility", "public")` on top of RLS to exclude it:
`getPopularPublicLists`, and `getProfileLists` for any viewer other than the
list owner (a profile's own Lists tab is a browsable index too, not a
direct link — an unlisted list stays reachable at `/lists/[id]` for anyone,
but does not appear there for a non-owner visitor).

### The `reorder_list_items` database function

Ranked-list reordering ships as accessible up/down/top/bottom controls only
— no drag-and-drop this prompt (explicit product decision). The reorder
itself is one atomic call to `reorder_list_items(p_list_id, p_item_ids)`
(migration 19), not a sequence of separate PostgREST update calls: a naive
sequence would transiently collide with `list_items`' own
`unique(list_id, position) deferrable initially deferred` constraint (e.g.
swapping positions 1 and 2 directly conflicts), since that constraint's
deferrability only helps _within one transaction_ — which a single function
call gets for free and a sequence of separate HTTP requests does not. The
function is `security invoker`, not `definer` — it runs as the calling
user, so every UPDATE inside it is still gated by `list_items`' existing
RLS; it re-validates ownership and that the submitted id array is exactly
the list's current item set before touching anything. This is not a
reversal of Prompt 4's "no RPC" decision (which was specifically about
avoiding a `security definer` bypass for a different problem) — this
function bypasses nothing.

### Activity feed: cursor pagination and current-visibility re-checking

**Cursor.** Keyset on `(created_at desc, id desc)` — a live-inserting feed
under offset pagination would skip or duplicate rows across pages, so this
deliberately deviates from the offset convention used everywhere else in
this codebase (library/diary/discover). The cursor is an opaque base64
string encoding `{t: created_at, i: id}` of the last _raw_ fetched row (see
below for why "raw," not "last rendered"); a malformed or tampered cursor
decodes to `null` and the feed silently resets to page 1 rather than
erroring.

**Re-checking visibility.** An `activity_events` row being safe to log at
INSERT time (`fn_log_list_activity()` already skips private lists) does
**not** mean it's still safe to _surface_ later — a list can go
private/unlisted after creation, or any referenced row can be deleted
outright, and stale metadata/links must never be shown. `getHomeFeed` never
renders directly from a raw `activity_events` row: it batch-fetches the
_current_ state of every referenced object (grouped by `object_type`, one
query per type present on the page — bounded ≤5, not per-row) through the
same RLS-scoped session client, and drops any event whose object is now
missing or (for `list_created` specifically) whose list is no longer
`public`. The next-page cursor is derived from the last row of the _raw_
fetched page, not the last _surviving_ (rendered) one — so a page can
legitimately render fewer cards than its page size without ever skipping or
duplicating an event on the next page. See
`src/server/services/activity-feed.test.ts` for the suppression and cursor
round-trip cases.

**Metadata already available**, used to avoid extra queries once an event
survives the visibility re-check:

| `event_type`         | `object_type` | `metadata` fields        | Extra fetch beyond the re-check?                                                                         |
| -------------------- | ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `review_published`   | `review`      | `{rating, has_spoilers}` | Yes — body isn't in metadata; the existence-check batch is extended to also select `body` for a snippet. |
| `game_rated`         | `user_game`   | `{rating}`               | No.                                                                                                      |
| `game_completed`     | `user_game`   | `{}`                     | No (game name comes from `activity_events.game_id`).                                                     |
| `diary_entry_logged` | `diary_entry` | `{played_on, is_replay}` | No.                                                                                                      |
| `list_created`       | `list`        | `{title, is_ranked}`     | No, beyond the visibility re-check itself.                                                               |
| `follow_created`     | `follow`      | `{following_id}`         | Batch the followed user's profile.                                                                       |

### Add-game-to-list flow

`AddGameToListDialog` reuses the existing `/api/search` endpoint (not
duplicated) for the search UX, but calls `addListItemAction(listId, igdbId)`
on selection instead of navigating. The action imports the game via the
existing `importGameByIgdbId()` (idempotent — a fresh local row
short-circuits with no IGDB call) before inserting the `list_items` row at
the current max position + 1 (never client-supplied). A dedicated rate-limit
bucket, `list-item-import:${user.id}` at 20/hour (same shape as
`review-create`'s), gates this independently of `/games/[slug]`'s own
import gate, since it's a second path that can trigger an IGDB call.

### Route structure

`/users/[username]` is real nested routes, not a client-side tab switch (no
such pattern exists elsewhere in this codebase, and "proper not-found and
loading states" per tab favors real routes): a segment `layout.tsx` fetches
the profile + `profile_stats` + the viewer's follow state once and renders
the shared header/nav; `page.tsx` (overview: recently played, favourites,
ratings distribution), `library/`, `diary/`, `reviews/`, `lists/`,
`followers/`, `following/` each own their own paginated fetch and
`loading.tsx`. `library`/`diary`/`reviews`/`lists` tabs are read-only even
for the profile's own owner — editing happens on the existing dedicated
`/library`/`/diary` pages and the new `/lists/[id]/edit`, not inline on a
page that's otherwise a public, browsable surface.

`/lists/new`, `/lists/[id]` (detail, public per its own visibility),
`/lists/[id]/edit` (owner-only — a non-owner or a missing list both 404,
indistinguishably, never confirming that a private list with that id
exists). `/home` (the feed) and `/discover/community` (kept separate from
Prompt 3's existing `/discover` game-catalogue page, to avoid touching
already-tested code) round out the new routes.

### `route-policy.ts`: pattern-matched gating

`/home` and `/lists/new` are exact-match gated entries, same as before.
`/lists/[id]/edit` is dynamic, so `route-policy.ts` adds a single
segment-aware regex, `/^\/lists\/[^/]+\/edit$/` — it matches exactly one
path segment between `/lists/` and `/edit` (not `/lists/x/y/edit`,
`/lists/x/edit/y`, or anything deeper). `isGatedPath()` is now the single
exported source of truth (replacing the old exported `GATED_PATHS` Set) —
it covers both the exact-match Sets and the pattern — and
`src/lib/supabase/session.ts` calls it directly rather than touching a raw
Set. This generalizes the fix for the exact class of bug Prompt 4 already
hit once (`/diary` silently skipping the profile lookup because a path was
gated in one file but not the other) to pattern-matched paths too.
`/lists/[id]` (view) and `/users/[username]/*` stay ungated at the route
level — visibility is per-resource via RLS/in-page checks, not a blanket
auth wall, since signed-out visitors must be able to load them.

### No client-forged activity events

Unchanged from Prompt 1: `activity_events` has zero INSERT/UPDATE/DELETE
grant for `anon`/`authenticated` — every row is written exclusively by the
`SECURITY DEFINER` trigger functions. No code added in this prompt attempts
to insert into `activity_events` directly, and none could succeed if it
tried.

### Manual two-user + one-private-list checklist

**Run in full by the user against the live app — every item below passed,
no regressions found.** Not run by Claude against live Supabase — this is a
live-browser manual check, same discipline as Prompt 4's checklist above.
No browser console or standalone-server terminal errors were observed
during the run. The one path deliberately verified a different way rather
than manually: an authenticated non-owner's runtime rejection from the
`reorder_list_items` database function was confirmed via the migration's
own `has_table_privilege`/`has_function_privilege` assertions and the
mocked unit tests in `src/server/actions/lists.test.ts`, not by handling
raw auth tokens in DevTools.

1. User A creates a **private** ranked list with 3 games, one with a note.
   Signed out in a second browser/incognito window, visit
   `/lists/{A's list id}` directly → 404 ("List not found"), not an error
   page, not a partial render.
2. Signed in as User B, visit the same URL → also 404. User B visits User
   A's profile (`/users/{A}/lists`) → the private list is not listed.
3. User A changes the list to **unlisted** → User B visiting the direct
   `/lists/{id}` URL now sees it fully (items, notes). User B visits
   `/users/{A}/lists` again → still not listed. User B visits
   `/discover/community`'s "Popular public lists" → not listed there either.
4. User A changes the list to **public** → now appears on both
   `/users/{A}/lists` (viewed by User B) and `/discover/community`.
5. User A reorders the 3 items using only the up/down/top/bottom buttons
   (keyboard-only pass: Tab to each control, Enter/Space to activate) →
   order persists after a full page reload.
6. User A removes one game, adds a different one via the search dialog
   (including one not previously imported — confirms the IGDB import path
   works) → both changes persist after reload.
7. User A deletes the list → redirected to their own Lists tab; the list
   id now 404s for everyone, including User A.
8. User B follows User A (`FollowButton` on User A's profile) → follower
   count increments immediately (optimistic), persists after reload. User B
   double-clicks rapidly (race simulation) → no error, final state is a
   single follow, no duplicate row.
9. User B unfollows → count decrements, persists after reload.
10. User A creates a **second** list, this one public, and writes a review
    and logs a diary entry for some game, all while User B still follows
    User A (re-follow from step 9 if needed) → User B's `/home` feed shows
    the new list, the review, and the diary entry, each linking correctly.
11. User A changes that second list's visibility to **private** → on User
    B's next `/home` page load (or "Load more"), the `list_created` feed
    item for it is gone. The review/diary items are unaffected (reviews and
    diary entries have no visibility tiers).
12. User A deletes their review from step 10 → User B's feed no longer
    shows that `review_published` item on next load; `/reviews/[id]` for it
    404s.
13. Signed-out visitor loads `/users/{A}`, `/users/{B}`, and any of the
    public lists above → every page renders fully (avatar, bio, stats,
    tabs, list contents), with "Sign in to follow" in place of a follow
    button and no like/edit controls anywhere they'd require a session.
14. Unauthenticated visitor hits `/home` or `/lists/new` directly →
    redirected to `/login?next=...`; after signing in, lands back on the
    originally requested page. A signed-in user with an incomplete profile
    (mid-onboarding) hits the same two routes → redirected to `/onboarding`.
