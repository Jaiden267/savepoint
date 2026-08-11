# Database schema

The Prompt 1 relational schema (17 application tables + 3 views + 1 storage
bucket) plus additive migrations from later milestones, as committed SQL
migrations under `supabase/migrations/`. **Migrations 1–17 are applied to
the live Supabase project and confirmed via read-only API verification**
(`npm run verify-schema`) and the Supabase CLI's migration history
(local/remote match). See [PROJECT_STATE.md](./PROJECT_STATE.md) for the
full verification results.

**Migration 18** (`20260812100000_add_igdb_game_metadata.sql`, Prompt 3) adds
4 more tables — `game_modes`, `themes`, `game_game_modes`, `game_themes`
(21 tables total) — plus 7 nullable columns on `games`. **Written but not
yet applied** as of this writing — see PROJECT_STATE.md for its live-application
status before trusting the table map below as fully accurate against the
live database.

This is the canonical reference for the schema — read this before writing any
query, RLS policy, or type against it.

## Table map

Grouped into the same six clusters as the migration files.

**Identity**

| Table      | Purpose                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `profiles` | One row per `auth.users` user — username, display name, bio, avatar path. Bootstrapped automatically on signup. |

**Catalog** (IGDB cache, server-managed)

| Table                                                                | Purpose                                                                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `games`                                                              | Cached IGDB game data, keyed by an internal UUID. No raw IGDB JSON payload.                                                                     |
| `genres` / `platforms` / `game_modes` / `themes`                     | Reference data, keyed by IGDB's own numeric ids. Populated by `game-sync.ts` on import (Prompt 3). `game_modes`/`themes` added by migration 18. |
| `game_genres` / `game_platforms` / `game_game_modes` / `game_themes` | Join tables linking games to genres/platforms/modes/themes. The latter two added by migration 18.                                               |

**User content**

| Table             | Purpose                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `user_games`      | One row per user/game: status (wishlist/backlog/playing/completed/paused/dropped) + optional 1–10 rating. |
| `diary_entries`   | Play logs — many rows allowed per user/game (repeat playthroughs).                                        |
| `reviews`         | At most one primary review per user/game — required rating + body + spoiler flag.                         |
| `review_likes`    | Binary like on a review.                                                                                  |
| `review_comments` | Comments on a review.                                                                                     |

**Lists & social**

| Table        | Purpose                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `lists`      | User-owned, ranked or unranked, with a `public`/`unlisted`/`private` visibility tier. |
| `list_items` | Games within a list, with position and an optional note.                              |
| `follows`    | Directed follower → following relationship.                                           |

**Activity & recommendations**

| Table                     | Purpose                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `activity_events`         | The feed — written exclusively by database triggers, never directly by a client.   |
| `recommendation_feedback` | shown/clicked/saved/dismissed/completed events for recommendation quality.         |
| `game_vector_sync`        | Pinecone sync ledger (status/timestamps/error only — no vector data). Server-only. |

**Storage**

| Bucket    | Purpose                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `avatars` | Public bucket; each user may only write within their own `<uid>/...` folder. No bucket exists for game artwork — IGDB image ids stay external references. |

## Relationship walkthrough

`auth.users` (Supabase-managed) is the root. `profiles` is a strict 1:1
extension of it, created by the `handle_new_user()` trigger the moment a user
signs up — there is no window where an authenticated user lacks a profile.

`games` is the anchor for all game-specific content: `user_games`,
`diary_entries`, `reviews`, and `list_items` all FK to it with
`ON DELETE RESTRICT` (see the delete-behavior table below — this is
deliberate). `genres`/`platforms` connect to `games` via the `game_genres`/
`game_platforms` join tables, which cascade-delete freely since they're pure
categorization metadata, not user content.

`reviews` in turn is the parent of `review_likes` and `review_comments`
(`ON DELETE CASCADE` — a like or comment has no meaning once its review is
gone). `lists` is the parent of `list_items` the same way.

`follows` is self-referential on `auth.users` (`follower_id`/`following_id`),
with a surrogate `id` column (rather than a bare composite PK) so it has the
same single-column identity shape as every other entity table — this is what
lets `activity_events.object_id` reference a real follow row for the
`follow_created` event.

`activity_events` is different from everything else: `object_id` is a
**polymorphic** reference into `reviews`/`user_games`/`diary_entries`/
`lists`/`follows` depending on `object_type`, and intentionally has **no
foreign key** (a single column cannot target five different tables).
Integrity is the responsibility of the trigger functions that are this
table's only write path — see the security notes below. `game_id` is
nullable and `ON DELETE SET NULL`, since a feed row should survive a game's
removal rather than block it or vanish.

`recommendation_feedback` and `game_vector_sync` sit off to the side as
analytics/sync bookkeeping, not user-curated content — hence their more
permissive `ON DELETE CASCADE` behavior on `game_id`.

## Delete-behavior table

Every foreign key in the schema, with its `ON DELETE` action and why.

| Column                                                                                                                                                                                                                                             | References                     | Action       | Why                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles.id`                                                                                                                                                                                                                                      | `auth.users(id)`               | CASCADE      | Account deletion removes the profile.                                                                                                                                                                                                              |
| `user_games.user_id`, `diary_entries.user_id`, `reviews.user_id`, `review_likes.user_id`, `review_comments.user_id`, `lists.user_id`, `follows.follower_id`, `follows.following_id`, `recommendation_feedback.user_id`, `activity_events.actor_id` | `auth.users(id)`               | CASCADE      | Account deletion removes the user's own rows everywhere.                                                                                                                                                                                           |
| `user_games.game_id`, `diary_entries.game_id`, `reviews.game_id`, `list_items.game_id`                                                                                                                                                             | `games(id)`                    | **RESTRICT** | These are user-authored/curated content anchored to a game. Deleting a game must never _silently_ wipe a user's rating/review/diary/list history — that has to be a conscious, separate decision (reassign, merge, or explicitly cascade by hand). |
| `game_genres.game_id`, `game_platforms.game_id`                                                                                                                                                                                                    | `games(id)`                    | CASCADE      | Pure categorization metadata, no standalone value — safe to clean up with the game.                                                                                                                                                                |
| `game_genres.genre_id`, `game_platforms.platform_id`                                                                                                                                                                                               | `genres(id)` / `platforms(id)` | CASCADE      | Same reasoning, other direction.                                                                                                                                                                                                                   |
| `review_likes.review_id`, `review_comments.review_id`                                                                                                                                                                                              | `reviews(id)`                  | CASCADE      | A like/comment has no meaning once its review is gone.                                                                                                                                                                                             |
| `list_items.list_id`                                                                                                                                                                                                                               | `lists(id)`                    | CASCADE      | Items are meaningless without their list.                                                                                                                                                                                                          |
| `activity_events.game_id`                                                                                                                                                                                                                          | `games(id)`                    | **SET NULL** | `activity_events` is a historical/informational log, not curated content — old feed entries should survive a game's removal (falling back to `metadata`) rather than block the deletion (RESTRICT) or silently vanish (CASCADE).                   |
| `recommendation_feedback.game_id`                                                                                                                                                                                                                  | `games(id)`                    | CASCADE      | Telemetry about a recommendation, not the user's own content — nothing worth preserving once the game is gone.                                                                                                                                     |
| `game_vector_sync.game_id`                                                                                                                                                                                                                         | `games(id)`                    | CASCADE      | Strict 1:1 sync-state satellite of `games`; no user content at stake.                                                                                                                                                                              |

## Security notes

- **`FORCE ROW LEVEL SECURITY` must never be added to `profiles` or
  `activity_events`.** Both tables rely on a `SECURITY DEFINER` trigger
  function (owned by the migration-running role) as their _only_ write path,
  which works because Postgres lets a table owner's `SECURITY DEFINER`
  function bypass RLS. `FORCE ROW LEVEL SECURITY` would remove that bypass —
  breaking the only insert path for both tables, with no alternative left.
- **Every `SECURITY DEFINER` function locks its `search_path`** to
  `public, pg_temp` and has `EXECUTE` revoked from `PUBLIC`. This closes the
  classic privilege-escalation hole where an attacker-controlled
  `search_path` could shadow a table/function the definer-function
  references. Functions: `handle_new_user()`, `fn_log_review_activity()`,
  `fn_log_user_game_activity()`, `fn_log_diary_activity()`,
  `fn_log_list_activity()`, `fn_log_follow_activity()`.
- **A trigger must never log an `activity_events` row about content that
  isn't itself publicly visible.** `activity_events` SELECT is public, so
  this invariant is what keeps that safe. Of the five activity triggers,
  only `fn_log_list_activity()` has a visibility gate to enforce (it skips
  `private` lists) — the other four source tables are already fully public.
- **RLS is the real, primary gate — GRANTs alone are not restrictive on a
  live Supabase project.** Migrations 11–15 were originally written assuming
  GRANTs start from nothing and must be explicitly opened up. Live read-only
  verification after applying them (`npm run verify-schema`) led to
  re-examining that assumption: Supabase's platform provisioning configures
  broad default privileges for `anon`/`authenticated` on every table in
  `public` (this is standard Supabase behavior — the platform's own model is
  "RLS is the thing you must configure; GRANTs are pre-opened"). Since
  `GRANT` only ever adds privilege and can never narrow a broader one already
  in place, the deliberately narrow `GRANT`s in migrations 11–15 did add the
  intended access, but did not remove the platform's broader default access
  underneath — meaning table/column-level GRANT scoping wasn't actually
  restrictive on its own. **RLS was and remains unaffected by this and is
  correctly enforcing every access boundary** (every policy ties visibility/
  mutation to `auth.uid()`, independent of GRANT breadth) — live
  verification confirms anon reads/writes behave exactly as intended across
  all 17 tables. What the broader default did put at risk was the _narrower_
  defense-in-depth intent behind several column-level `GRANT`s — e.g. an
  authenticated user updating their own row could still set columns meant to
  be server/trigger-only (`created_at`, or reassigning `user_games.game_id`/
  `list_items.game_id` to a different game), since RLS's `WITH CHECK`
  validates row _ownership_, not _which columns_ were touched. Migration 16
  (`20260811140000_harden_default_privileges.sql`) explicitly `REVOKE`s the
  broad defaults (existing objects and future ones, via
  `ALTER DEFAULT PRIVILEGES`) and re-asserts every intentional `GRANT` from
  migrations 11–15 verbatim, making them actually restrictive. `service_role`
  (`src/lib/supabase/admin.ts`) is never touched by this — it bypasses RLS
  and holds its own broad access by Supabase's design, independent of this
  schema's GRANTs.
- **Owner columns default to `auth.uid()` and are excluded from client
  INSERT grants.** Every table with a `user_id`-shaped column (`user_games`,
  `diary_entries`, `reviews`, `review_likes`, `review_comments`, `lists`,
  `follows.follower_id`, `recommendation_feedback`) sets
  `default auth.uid()` on that column and does **not** grant `INSERT` on it
  to `authenticated`. A client literally cannot supply someone else's
  `user_id` — not just because a policy would reject it, but because it has
  no privilege to set that column at all. `WITH CHECK (user_id = auth.uid())`
  is still present on every policy as defense in depth.
- **No denormalized aggregate columns anywhere.** `game_rating_stats`,
  `review_like_counts`, and `profile_stats` are `security_invoker = true`
  views that re-run under the _caller's_ RLS — they can only ever surface
  what that caller could already see by querying the base tables directly.
  This is only safe because `user_games` and `review_likes` are themselves
  publicly readable (see the RLS matrix below); if either became
  private-by-default in the future, these views would need to become
  `SECURITY DEFINER`, which is deliberately avoided here.
- **Known limitation:** `activity_events.object_id` has no FK (it targets
  five different tables depending on `object_type`), so deleting a source
  row does not cascade-delete its activity row. Feed queries should tolerate
  a dangling `object_id`; a later milestone may add companion cleanup.

## RLS matrix

RLS is enabled on **every** table. `anon`/`authenticated` are Postgres roles
routed through the Data API (the publishable-key clients); `service_role`
(`src/lib/supabase/admin.ts`) bypasses RLS and GRANTs entirely by default and
is omitted below except where noted.

| Table                                | SELECT                                                   | INSERT                                                    | UPDATE                                                   | DELETE               |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- | -------------------- |
| `profiles`                           | public                                                   | none (trigger-only)                                       | own row; only `username, display_name, bio, avatar_path` | none                 |
| `games`                              | public                                                   | none (service-role only)                                  | none                                                     | none                 |
| `genres`                             | public                                                   | none                                                      | none                                                     | none                 |
| `platforms`                          | public                                                   | none                                                      | none                                                     | none                 |
| `game_genres`                        | public                                                   | none                                                      | none                                                     | none                 |
| `game_platforms`                     | public                                                   | none                                                      | none                                                     | none                 |
| `user_games`                         | public                                                   | own rows (`user_id = auth.uid()`)                         | own rows                                                 | own rows             |
| `diary_entries`                      | public                                                   | own rows                                                  | own rows                                                 | own rows             |
| `reviews`                            | public                                                   | own rows                                                  | own rows                                                 | own rows             |
| `review_likes`                       | public                                                   | own rows                                                  | none (not editable)                                      | own rows             |
| `review_comments`                    | public                                                   | own rows                                                  | own rows                                                 | own rows             |
| `lists`                              | `public`/`unlisted` to everyone; `private` to owner only | own rows                                                  | own rows                                                 | own rows             |
| `list_items`                         | follows parent list's visibility rule (`EXISTS` check)   | owner of parent list                                      | owner of parent list                                     | owner of parent list |
| `follows`                            | public                                                   | own outgoing follow (`follower_id = auth.uid()`)          | none (immutable)                                         | own outgoing follow  |
| `activity_events`                    | public                                                   | **none for anon/authenticated** — trigger-only            | none                                                     | none                 |
| `recommendation_feedback`            | own rows only (`authenticated` only, not public)         | own rows                                                  | none                                                     | own rows             |
| `game_vector_sync`                   | **none** — zero grants for anon/authenticated            | none                                                      | none                                                     | none                 |
| `storage.objects` (`avatars` bucket) | public (`bucket_id = 'avatars'`)                         | own folder (`(storage.foldername(name))[1] = auth.uid()`) | own folder                                               | own folder           |

**Why `user_games`/`diary_entries` are public:** matches the product vision
("view profiles, diary history, ratings and statistics") and Letterboxd's own
public-by-default model — there's no privacy setting in this schema yet. This
is also what makes `game_rating_stats` safe as a plain `security_invoker`
view (see security notes above).

**Why `unlisted` behaves like `public` at the RLS layer:** "unlisted" means
reachable by anyone who has the id/link, not hidden from access entirely —
the distinction from `public` (excluded from browse/discovery queries) is an
application query-shaping concern, not a database access-control one.

## Migration files, applied in order

1. `20260811120000_enable_extensions.sql`
2. `20260811120500_create_profiles.sql`
3. `20260811121000_create_games_and_reference_tables.sql`
4. `20260811121500_create_user_content_tables.sql`
5. `20260811122000_create_lists_and_social_tables.sql`
6. `20260811122500_create_activity_and_recommendation_tables.sql`
7. `20260811123000_updated_at_trigger.sql`
8. `20260811123500_profile_bootstrap_trigger.sql`
9. `20260811124000_activity_events_triggers.sql`
10. `20260811124500_aggregate_views.sql`
11. `20260811125000_rls_reference_data_policies.sql`
12. `20260811125500_rls_user_content_policies.sql`
13. `20260811130000_rls_lists_social_policies.sql`
14. `20260811130500_rls_activity_recommendation_policies.sql`
15. `20260811131000_storage_avatars_bucket.sql`
16. `20260811140000_harden_default_privileges.sql` — corrective, applied
    after live verification of 1–15 (see the GRANTs security note above).
17. `20260812090000_add_onboarding_completed_to_profiles.sql` (Prompt 2) —
    adds `profiles.onboarding_completed_at`. Applied, confirmed live.
18. `20260812100000_add_igdb_game_metadata.sql` (Prompt 3) — adds
    `game_modes`/`themes`/`game_game_modes`/`game_themes` + 7 `games`
    columns (see [docs/IGDB.md](./IGDB.md#field-mapping)). **Written, not
    yet applied** — see PROJECT_STATE.md.

Each table/reference-table-cluster is created with RLS enabled and **zero**
policies (files 1–6) before any policy is added (files 11–15) — a table is
fail-closed the instant it exists, never openly accessible during setup.

## Live verification

`scripts/verify-schema.mts` (`npm run verify-schema`) is a safe, read-only,
non-destructive check against the actual live project, using **only the
publishable key** (`anon` role — no session). It confirms: every table/view
is reachable via the API, public reads return data (or a correctly-empty
result) where expected, server-only tables correctly show zero rows to
`anon`, and — decisively — that `anon` cannot INSERT into any of the 17
tables (Postgres raises a hard RLS/permission error for INSERT when no
policy permits it, unlike SELECT/UPDATE/DELETE, which just filter rows
silently). It never creates persistent data: every write probe uses a
random, non-existent foreign key, and since Postgres checks privileges
before constraints, the outcome is always one of "correctly denied",
"denied only by the fake FK" (a real finding, would need investigation), or
—in the unexpected case a probe ever succeeds — an immediate same-run
cleanup delete before anything is reported. Safe to re-run any time; prints
no keys, URLs, or row contents.
