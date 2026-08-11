-- Corrective migration (Prompt 1 follow-up, after live read-only
-- verification of migrations 1-15).
--
-- WHAT THIS FIXES
-- Supabase's platform provisioning configures broad default privileges
-- (roughly `GRANT ALL ON TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public TO
-- anon, authenticated`, plus matching `ALTER DEFAULT PRIVILEGES` for future
-- objects) so that Row Level Security alone is the everyday mental model for
-- most Supabase projects. Every GRANT statement in migrations 11-15 was
-- written assuming a narrow starting point ("nothing is granted until we
-- explicitly grant it") — but GRANT is purely additive. It cannot narrow an
-- already-broader privilege. Against Supabase's actual default state, those
-- GRANTs did add the intended access, but did NOT remove the platform's
-- broader default access sitting underneath them.
--
-- RLS itself is unaffected by this and was already doing its job: every
-- policy in this schema correctly ties row visibility/mutation to
-- `auth.uid()`, so cross-user access (reading/writing someone else's row,
-- or anon accessing anything at all) was never actually open — RLS's own
-- USING/WITH CHECK clauses are a complete, independent gate regardless of
-- the underlying GRANT breadth. Live verification (npm run verify-schema)
-- confirms anon reads/writes behave exactly as intended across all 17
-- tables.
--
-- What WAS at risk: the narrower, defense-in-depth intent behind several
-- *column-level* GRANTs — e.g. `grant update (username, display_name, bio,
-- avatar_path) on public.profiles to authenticated` was meant to make
-- `id`/`created_at` un-settable by a client even on their own row. Because
-- the platform's default privilege is broader (all columns), an
-- authenticated user updating their own row could still have set columns
-- this project only intended to be server/trigger-managed — e.g.
-- `created_at`, or `user_games.game_id`/`list_items.game_id`
-- (reassigning a rating or list entry to a different game entirely). RLS's
-- `WITH CHECK (user_id = auth.uid())` correctly stops cross-user tampering
-- either way (ownership is what it checks), but does not know or care which
-- columns were part of the client's UPDATE.
--
-- This migration explicitly REVOKEs the broad default privileges first, for
-- both existing objects and future ones (via ALTER DEFAULT PRIVILEGES), then
-- re-asserts the exact same intentional GRANTs already present in
-- migrations 11-15 — verbatim, so this file alone is a complete, reviewable
-- statement of the final intended privilege state. This is the standard,
-- documented Supabase pattern for making column-level (or otherwise
-- narrower-than-default) grants actually restrictive.
--
-- Idempotent and safe regardless of the exact current privilege state: if
-- the defaults were already narrow, this is a no-op followed by re-granting
-- what already existed. `service_role` is never touched — it bypasses RLS
-- and holds its own broad access by Supabase's design, independent of this
-- schema's GRANTs, and must remain that way for the admin client
-- (src/lib/supabase/admin.ts) to keep working.
--
-- Run as a single paste in the SQL Editor: multiple statements submitted
-- together this way execute as one implicit transaction (Postgres's simple
-- query protocol), so the REVOKE and every re-GRANT below either all apply
-- together or none do — there is no partial-revoke window.

revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;

alter default privileges in schema public
  revoke all on tables from anon, authenticated, public;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated, public;
alter default privileges in schema public
  revoke all on functions from anon, authenticated, public;

-- Re-grant exactly what migrations 11-15 already intended, table by table.

-- profiles
grant select on public.profiles to anon, authenticated;
grant update (username, display_name, bio, avatar_path) on public.profiles to authenticated;

-- games / genres / platforms / game_genres / game_platforms: read-only for
-- anon/authenticated, no write grant at all (service-role only).
grant select on public.games to anon, authenticated;
grant select on public.genres to anon, authenticated;
grant select on public.platforms to anon, authenticated;
grant select on public.game_genres to anon, authenticated;
grant select on public.game_platforms to anon, authenticated;

-- user_games
grant select on public.user_games to anon, authenticated;
grant insert (game_id, status, rating) on public.user_games to authenticated;
grant update (status, rating) on public.user_games to authenticated;
grant delete on public.user_games to authenticated;

-- diary_entries
grant select on public.diary_entries to anon, authenticated;
grant insert (game_id, played_on, rating, is_replay, note) on public.diary_entries to authenticated;
grant update (played_on, rating, is_replay, note) on public.diary_entries to authenticated;
grant delete on public.diary_entries to authenticated;

-- reviews
grant select on public.reviews to anon, authenticated;
grant insert (game_id, rating, body, has_spoilers) on public.reviews to authenticated;
grant update (rating, body, has_spoilers) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

-- review_likes
grant select on public.review_likes to anon, authenticated;
grant insert (review_id) on public.review_likes to authenticated;
grant delete on public.review_likes to authenticated;

-- review_comments
grant select on public.review_comments to anon, authenticated;
grant insert (review_id, body) on public.review_comments to authenticated;
grant update (body) on public.review_comments to authenticated;
grant delete on public.review_comments to authenticated;

-- lists
grant select on public.lists to anon, authenticated;
grant insert (title, description, is_ranked, visibility) on public.lists to authenticated;
grant update (title, description, is_ranked, visibility) on public.lists to authenticated;
grant delete on public.lists to authenticated;

-- list_items
grant select on public.list_items to anon, authenticated;
grant insert (list_id, game_id, position, note) on public.list_items to authenticated;
grant update (position, note) on public.list_items to authenticated;
grant delete on public.list_items to authenticated;

-- follows
grant select on public.follows to anon, authenticated;
grant insert (following_id) on public.follows to authenticated;
grant delete on public.follows to authenticated;

-- activity_events: read-only, no write grant of any kind (trigger-only writes).
grant select on public.activity_events to anon, authenticated;

-- recommendation_feedback: authenticated-only, own rows (enforced by RLS).
grant select on public.recommendation_feedback to authenticated;
grant insert (game_id, event_type) on public.recommendation_feedback to authenticated;
grant delete on public.recommendation_feedback to authenticated;

-- game_vector_sync: zero grants of any kind for anon/authenticated
-- (server-only) — deliberately no grant statement here.

-- Aggregate views
grant select on public.game_rating_stats to anon, authenticated;
grant select on public.review_like_counts to anon, authenticated;
grant select on public.profile_stats to anon, authenticated;
