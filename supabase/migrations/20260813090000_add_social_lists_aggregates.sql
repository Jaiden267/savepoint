-- Prompt 5 (lists/social/profiles) additive aggregates + one atomic RPC.
-- Two security_invoker views (bounded, safe aggregates) and one security
-- invoker function for atomic ranked-list reordering. Applied manually by
-- the project owner via the Supabase CLI, per this project's established
-- migration workflow (see 20260812100000's precedent) — not applied by this
-- migration file's mere existence in the repo.

-- 1. user_rating_distribution -------------------------------------------------
-- Per-user rating histogram: bucket rating 1-10 -> count of games. Bounded to
-- at most 10 rows per user regardless of library size — unlike a per-GAME
-- histogram (deliberately not built in Prompt 4; see docs/SOCIAL.md), this
-- can never hit PostgREST's default row cap.
create view public.user_rating_distribution
with (security_invoker = true) as
select
  user_id,
  rating,
  count(*) as game_count
from public.user_games
where rating is not null
group by user_id, rating;

-- 2. list_public_summary -------------------------------------------------------
-- lists.* plus item_count, so "popular public lists" can `order by
-- item_count desc` — PostgREST cannot order on an embedded child aggregate
-- when querying `lists` directly. security_invoker means a private/unlisted
-- list is never returned here to a viewer who couldn't already see it via
-- `lists`' own RLS; callers additionally filter `visibility = 'public'`
-- explicitly for discovery surfaces (`unlisted` stays RLS-readable by direct
-- id but must never appear in browse/discovery — existing documented
-- convention, see docs/DATABASE.md).
create view public.list_public_summary
with (security_invoker = true) as
select
  l.id,
  l.user_id,
  l.title,
  l.description,
  l.is_ranked,
  l.visibility,
  l.created_at,
  l.updated_at,
  count(li.id) as item_count
from public.lists l
left join public.list_items li on li.list_id = l.id
group by l.id;

-- 3. reorder_list_items ---------------------------------------------------------
-- Atomic ranked-list reorder. SECURITY INVOKER (not DEFINER) — runs as the
-- calling user, so it cannot bypass RLS; every UPDATE inside is still gated
-- by list_items' existing RLS policies (defense in depth on top of RLS, not
-- a replacement for it). This is not a reversal of the "no RPC" precedent
-- from Prompt 4 (docs/SOCIAL.md's "RPC decision"), which was specifically
-- about avoiding a SECURITY DEFINER bypass for a different problem; this
-- function bypasses nothing.
--
-- Exists because a sequence of separate PostgREST update calls (each its own
-- transaction) can transiently collide with list_items' own
-- `unique (list_id, position) deferrable initially deferred` constraint
-- (e.g. swapping positions 1 and 2 directly conflicts). That constraint's
-- deferrability only helps within a single transaction — which one function
-- call gets for free, and a sequence of separate HTTP requests does not.
create or replace function public.reorder_list_items(
  p_list_id uuid,
  p_item_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item_id uuid;
  v_position integer := 0;
  v_expected_count integer;
  v_submitted_count integer;
  v_distinct_count integer;
begin
  if not exists (
    select 1 from public.lists
    where id = p_list_id and user_id = auth.uid()
  ) then
    raise exception 'Not authorized to reorder this list.'
      using errcode = '42501';
  end if;

  select count(*) into v_expected_count
  from public.list_items
  where list_id = p_list_id;

  v_submitted_count := coalesce(array_length(p_item_ids, 1), 0);

  select count(distinct x) into v_distinct_count
  from unnest(p_item_ids) as x;

  if v_submitted_count <> v_expected_count
    or v_distinct_count <> v_submitted_count
  then
    raise exception 'Submitted item set does not match the list''s current items.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as x(id)
    where not exists (
      select 1 from public.list_items
      where id = x.id and list_id = p_list_id
    )
  ) then
    raise exception 'Submitted item set does not match the list''s current items.'
      using errcode = '22023';
  end if;

  foreach v_item_id in array p_item_ids loop
    v_position := v_position + 1;
    update public.list_items
    set position = v_position
    where id = v_item_id and list_id = p_list_id;
  end loop;
end;
$$;

revoke all on function public.reorder_list_items(uuid, uuid[]) from public;
grant execute on function public.reorder_list_items(uuid, uuid[]) to authenticated;

-- Explicit privileges ------------------------------------------------------------
-- Migration 16 (20260811140000_harden_default_privileges.sql) revoked broad
-- default privileges for anon/authenticated on every table AND altered
-- default privileges so future objects don't silently inherit Supabase's
-- platform-wide default grant either. That means these two new views start
-- with effectively no anon/authenticated access unless explicitly granted
-- below — these grants are required, not defensive, exactly like migration
-- 18's game_modes/themes precedent.
revoke all on public.user_rating_distribution from public;
grant select on public.user_rating_distribution to anon, authenticated;

revoke all on public.list_public_summary from public;
grant select on public.list_public_summary to anon, authenticated;

-- (reorder_list_items's own grants are issued immediately above its definition.)

-- Read-only privilege assertions --------------------------------------------------
-- Fail the migration itself if any grant above didn't take, rather than
-- applying silently-incorrect privileges. Checks static grants only, not RLS
-- row-filtering behavior — runtime behavior is checked separately by
-- scripts/verify-schema.mts (anonymous HTTP only) and, for the
-- authenticated-non-owner case, by the Phase B manual two-user checklist;
-- neither of those two can substitute for this static check, and this check
-- cannot substitute for either of those (see docs/SOCIAL.md).
do $$
begin
  if not has_table_privilege('anon', 'public.user_rating_distribution', 'select') then
    raise exception 'anon is missing SELECT on user_rating_distribution';
  end if;
  if not has_table_privilege('authenticated', 'public.user_rating_distribution', 'select') then
    raise exception 'authenticated is missing SELECT on user_rating_distribution';
  end if;

  if not has_table_privilege('anon', 'public.list_public_summary', 'select') then
    raise exception 'anon is missing SELECT on list_public_summary';
  end if;
  if not has_table_privilege('authenticated', 'public.list_public_summary', 'select') then
    raise exception 'authenticated is missing SELECT on list_public_summary';
  end if;

  if not has_function_privilege('authenticated', 'public.reorder_list_items(uuid, uuid[])', 'execute') then
    raise exception 'authenticated is missing EXECUTE on reorder_list_items';
  end if;
  if has_function_privilege('anon', 'public.reorder_list_items(uuid, uuid[])', 'execute') then
    raise exception 'anon unexpectedly has EXECUTE on reorder_list_items';
  end if;
end;
$$;
