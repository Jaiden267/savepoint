# Core tracking: library, diary, reviews, likes, comments

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
