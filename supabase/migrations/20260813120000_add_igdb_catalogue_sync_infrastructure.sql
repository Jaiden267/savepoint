-- Prompt 7C (broad IGDB catalogue semantic indexing) — Gate A1.
--
-- Infrastructure only: this migration creates the resumable, checkpointed
-- catalogue-discovery ledger and its atomic checkpoint RPC. It does NOT
-- perform, schedule, or authorize any catalogue discovery or Pinecone
-- catalogue upsert — those remain gated behind separate, explicit
-- approvals (Gates B through E) applied through application code, never
-- through this migration. Applied manually by the project owner via the
-- Supabase CLI/SQL Editor, per this project's established migration
-- workflow — not applied by this file's mere existence in the repo.
--
-- Four additive pieces:
--   1. game_vector_sync.schema_version — lets the existing on-demand sync
--      path (src/lib/pinecone/sync.ts) tell a legacy (pre-catalogue)
--      Pinecone record apart from one written under the new schema, so a
--      "already synced" game still gets re-embedded once, on its next
--      touch, under the new record shape.
--   2. igdb_catalogue_discovery_cursor — one row per named cursor
--      (discover:<profile>:gen<N>, incremental:<profile>,
--      release-check:<profile>), each independently resumable.
--   3. igdb_catalogue_sync — the per-IGDB-game sync ledger. Deliberately
--      NOT keyed by games.id: most catalogue candidates won't have a
--      Supabase games row at all, unlike game_vector_sync's existing
--      strict 1:1-with-an-already-cached-row design.
--   4. igdb_catalogue_lease — a single durable, fenced, heartbeat-renewed
--      lease shared by every mutating catalogue command, so discover/
--      sync/incremental/release-check can never run concurrently with
--      each other or with themselves, and a crashed worker's lease is
--      safely reclaimable once it expires.
--
-- Plus one RPC, advance_catalogue_discovery: the only way any of the
-- three new tables above are ever mutated by discovery-family commands.
-- SECURITY INVOKER, not DEFINER — this function is only ever called by
-- the admin/service-role Supabase client (the same client already used
-- everywhere else in this codebase's server-only sync code), and
-- service_role already bypasses RLS at the Postgres role level
-- regardless of the function's security mode. There is no cross-
-- privilege need that would justify SECURITY DEFINER's privilege-
-- escalation risk. `set search_path = ''` is kept anyway (cheap, correct
-- regardless of INVOKER/DEFINER, avoids any schema-resolution ambiguity)
-- with every object reference fully qualified as public.*.

-- 1. game_vector_sync.schema_version ----------------------------------------
-- Additive, nullable. NULL means "written before this column existed" —
-- i.e. every one of the 9 live Pinecone records as of this migration,
-- which used the old (Supabase-UUID) record id/shape. syncGameVector's
-- "already synced, skip" check is updated (application code, not this
-- migration) to also require schema_version = the current constant, so a
-- legacy row is re-synced under the new schema on its very next on-demand
-- trigger rather than skipped forever.
alter table public.game_vector_sync add column schema_version integer;

comment on column public.game_vector_sync.schema_version is
  'Which Pinecone record schema version the last successful sync wrote. '
  'NULL = written before this column existed (the legacy Supabase-UUID-'
  'keyed record shape). Distinct from last_synced_at/status, which track '
  'IGDB content freshness, not Pinecone record-schema freshness.';

-- 2. igdb_catalogue_discovery_cursor -----------------------------------------
-- One row per named cursor. Three cursor *kinds* share this one table
-- shape rather than three separate tables, since they differ only in
-- which watermark columns they actually use:
--   discover:<profile>:gen<N>   -> last_igdb_id (id-ordered, server-side
--                                  profile-filtered full sweep)
--   incremental:<profile>       -> last_updated_at + last_updated_at_igdb_id
--                                  (IGDB-wide updated_at watermark, tie-safe)
--   release-check:<profile>     -> last_release_check + last_release_check_igdb_id
--                                  (first_release_date watermark, tie-safe —
--                                  catches a future-dated game becoming
--                                  eligible purely because time passed,
--                                  which neither of the other two cursors
--                                  is guaranteed to catch)
-- A fresh generation of `discover` (an explicit, operator-triggered full
-- rescan after the previous generation already completed) gets its own
-- new cursor_name/row rather than resetting an existing one — nothing is
-- ever deleted here, and a new generation's resumability is independent
-- of any prior generation's.
create table public.igdb_catalogue_discovery_cursor (
  cursor_name                 text primary key,
  last_igdb_id                integer,
  last_updated_at             timestamptz,
  last_updated_at_igdb_id     integer,
  last_release_check          timestamptz,
  last_release_check_igdb_id  integer,
  last_applied_page_key       text,
  candidates_discovered       integer not null default 0,
  completed_at                timestamptz,
  updated_at                  timestamptz not null default now()
);

comment on table public.igdb_catalogue_discovery_cursor is
  'Resumable watermark/checkpoint state for the catalogue discovery '
  'commands (discover/incremental/release-check), one row per named '
  'cursor. Mutated exclusively through advance_catalogue_discovery() — '
  'never updated directly, so its compare-and-set/fencing guarantees '
  'always apply.';

comment on column public.igdb_catalogue_discovery_cursor.candidates_discovered is
  'A PER-CURSOR scan-progress counter: how many unique eligible '
  'candidates this cursor''s own pages have encountered so far, '
  'INCLUDING ones already known globally from another cursor or an '
  'earlier generation. Never a global "new games found" count and never '
  'meant to be summed across cursor rows as "total catalogue coverage" — '
  'that figure is always select count(*) from igdb_catalogue_sync '
  'directly. A second discover generation that re-confirms the same '
  'eligible set as generation 1 correctly reports this equal to '
  'generation 1''s total, not zero.';

comment on column public.igdb_catalogue_discovery_cursor.last_applied_page_key is
  'The deterministic idempotency key of the last page successfully '
  'applied to this cursor (see advance_catalogue_discovery()). Used both '
  'as an exact-retry short-circuit and as the compare-and-set pointer a '
  'caller must present as "previous" for its own page to be accepted — '
  'a stale or out-of-order page (its expected-previous no longer matches '
  'this column''s current value) is rejected without mutating anything.';

comment on column public.igdb_catalogue_discovery_cursor.last_release_check is
  'Watermark for the release-check cursor kind only. Must never be left '
  'NULL once discovery for a profile has begun: `first_release_date > '
  'NULL` is NULL (never true) in Postgres, which would silently produce '
  'an empty scan forever rather than an error. Seeded explicitly by '
  'discover''s first generation for a profile, to a point at-or-before '
  'that generation''s own start time, before release-check is ever run '
  'for that profile — see docs/PINECONE.md for the exact sequencing.';

-- 3. igdb_catalogue_sync ------------------------------------------------------
-- The per-IGDB-game catalogue sync ledger. Deliberately NOT games.id and
-- NOT a foreign key to games at all (unlike game_vector_sync) — most rows
-- here describe an IGDB game Savepoint has never cached. igdb_id alone is
-- the stable identity. profile records which catalogue profile most
-- recently deemed a row eligible (informational). The claim/lease/
-- finalize protocol for the actual per-record Pinecone sync step (status/
-- attempt_count/last_attempted_at optimistic-lock claim) mirrors
-- game_vector_sync's and scripts/pinecone-backfill.mts's existing
-- protocol exactly, just keyed by igdb_id instead of game_id.
create table public.igdb_catalogue_sync (
  igdb_id           integer primary key,
  status            text not null default 'pending' check (
    status in ('pending', 'synced', 'failed', 'ineligible')
  ),
  profile           text,
  attempt_count     integer not null default 0,
  last_attempted_at timestamptz,
  last_synced_at    timestamptz,
  igdb_updated_at   timestamptz,
  error             text,
  updated_at        timestamptz not null default now()
);

comment on table public.igdb_catalogue_sync is
  'Per-IGDB-game catalogue sync ledger for broad semantic indexing. Not '
  'keyed by (and has no FK to) games — most rows describe an IGDB game '
  'not yet cached in Supabase. igdb_id is the sole stable identity. '
  'Rows/status are written exclusively through advance_catalogue_discovery() '
  '(candidate insertion/eligibility) and the per-record sync claim/finalize '
  'protocol implemented in application code (scripts/igdb-catalogue-sync.mts), '
  'mirroring game_vector_sync''s existing protocol. Server-only: no RLS '
  'policy or GRANT of any kind for anon/authenticated.';

comment on column public.igdb_catalogue_sync.status is
  '''ineligible'' (new relative to game_vector_sync''s status enum) marks '
  'a game that incremental/release-check discovered was previously '
  'eligible but no longer is (type changed, delisted, etc.) — never '
  'auto-deletes its Pinecone record; that requires separate, explicit, '
  'future approval.';

comment on column public.igdb_catalogue_sync.igdb_updated_at is
  'IGDB''s own updated_at for this game, converted from its native '
  'Unix-seconds representation via to_timestamp() — never a direct cast '
  '(a raw ::timestamptz cast on a Unix-seconds integer is a Postgres '
  'value-interpretation bug, not a valid conversion).';

create index igdb_catalogue_sync_pending_idx
  on public.igdb_catalogue_sync (status)
  where status in ('pending', 'failed');

-- 4. igdb_catalogue_lease ------------------------------------------------------
-- Single-row singleton (the `id boolean ... check (id)` trick permits
-- exactly one row, always id = true). Seeded below so acquire logic
-- always has a row to conditionally UPDATE against — no insert-vs-update
-- ambiguity ever needed. One lease governs every mutating catalogue
-- command (discover/sync/incremental/release-check); read-only commands
-- (status/verify/the estimator) never touch it. See docs/PINECONE.md for
-- the full acquire/heartbeat/release protocol.
create table public.igdb_catalogue_lease (
  id          boolean primary key default true check (id),
  token       uuid,
  holder      text,
  command     text check (command in ('discover', 'sync', 'incremental', 'release-check')),
  acquired_at timestamptz,
  lease_until timestamptz
);

comment on table public.igdb_catalogue_lease is
  'Single-row global fencing lease shared by every mutating catalogue '
  'command, so discover/sync/incremental/release-check can never run '
  'concurrently with each other or with themselves. token is NULL when '
  'unheld; a lease past lease_until is stale and reclaimable by the next '
  'acquire attempt. Server-only: no RLS policy or GRANT of any kind for '
  'anon/authenticated.';

insert into public.igdb_catalogue_lease (id, token, lease_until)
  values (true, null, null);

-- 5. advance_catalogue_discovery() --------------------------------------------
-- The one atomic checkpoint RPC for discovery-family commands: candidate
-- upsert + eligibility-loss marking + cursor advancement all happen
-- together in one transaction, or (on any failure/crash) none of it does
-- — the next attempt safely re-fetches and re-applies the same page,
-- which is a no-op for anything already durably stored.
--
-- Fencing: the lease-token check happens first, inside the same
-- transaction as everything else — a stale/reclaimed worker's call raises
-- and rolls back before touching anything.
--
-- Real compare-and-set, not merely a duplicate-retry check:
-- p_page_key alone only recognizes an exact repeat of the page already
-- applied. p_expected_previous_page_key is what makes this genuine
-- optimistic concurrency control — the caller must present the cursor's
-- actual current pointer as "what I started from," or the call is
-- rejected as stale/out-of-order before any mutation (an old page
-- retried after a newer one already landed, or a page computed against a
-- since-superseded read). The deterministic page-key construction lives
-- in application code (scripts/igdb-catalogue-sync.mts): a hash over the
-- exact page content (sorted unique candidate igdb_ids + every "new
-- cursor value" argument being sent), so an immediate retry after a
-- dropped response always reproduces the same key without needing to
-- inspect database state first.
--
-- Candidates are normalized (deduplicated by igdb_id) before touching the
-- ledger — a page containing the same igdb_id twice would otherwise make
-- the upsert try to affect one target row twice, which Postgres rejects
-- outright. `xmax = 0` on the RETURNING row distinguishes a genuine
-- INSERT from an ON CONFLICT UPDATE, giving both counters
-- (candidates_encountered, new_ledger_rows) from one atomic pass with no
-- separate pre-check query and no race between checking and inserting.
create or replace function public.advance_catalogue_discovery(
  p_cursor_name text,
  p_lease_token uuid,
  p_page_key text,
  p_expected_previous_page_key text,
  p_candidates jsonb default '[]'::jsonb,
  p_mark_ineligible integer[] default '{}',
  p_new_last_igdb_id integer default null,
  p_new_last_updated_at_unix bigint default null,
  p_new_last_updated_at_igdb_id integer default null,
  p_new_last_release_check_unix bigint default null,
  p_new_last_release_check_igdb_id integer default null,
  p_mark_completed boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lease_ok boolean;
  v_prev_key text;
  v_encountered_count integer;
  v_new_ledger_rows integer;
begin
  select (token = p_lease_token and lease_until > now())
    into v_lease_ok
    from public.igdb_catalogue_lease
    where id = true
    for update;

  if v_lease_ok is not true then
    raise exception 'catalogue lease not held or expired for token %', p_lease_token
      using errcode = '55000';
  end if;

  insert into public.igdb_catalogue_discovery_cursor (cursor_name)
    values (p_cursor_name)
    on conflict (cursor_name) do nothing;

  select last_applied_page_key into v_prev_key
    from public.igdb_catalogue_discovery_cursor
    where cursor_name = p_cursor_name
    for update;

  -- Exact retry of the page already applied: no-op, no mutation.
  if v_prev_key is not distinct from p_page_key then
    return jsonb_build_object('status', 'already_applied', 'cursor_name', p_cursor_name);
  end if;

  -- Compare-and-set: reject a stale or out-of-order page before any
  -- mutation happens.
  if v_prev_key is distinct from p_expected_previous_page_key then
    raise exception
      'stale or out-of-order page for cursor %: expected previous key %, cursor is actually at %',
      p_cursor_name, p_expected_previous_page_key, v_prev_key
      using errcode = '40001';
  end if;

  with normalized as (
    select distinct on ((c->>'igdb_id')::integer)
      (c->>'igdb_id')::integer as igdb_id,
      c->>'profile' as profile,
      (c->>'igdb_updated_at_unix')::bigint as igdb_updated_at_unix
    from jsonb_array_elements(p_candidates) as c
    order by (c->>'igdb_id')::integer
  ),
  applied as (
    insert into public.igdb_catalogue_sync (igdb_id, status, profile, igdb_updated_at, updated_at)
    select n.igdb_id, 'pending', n.profile, to_timestamp(n.igdb_updated_at_unix), now()
    from normalized n
    on conflict (igdb_id) do update set
      status = case
        when public.igdb_catalogue_sync.status = 'synced'
         and public.igdb_catalogue_sync.igdb_updated_at >= excluded.igdb_updated_at
        then public.igdb_catalogue_sync.status
        else 'pending' end,
      igdb_updated_at = excluded.igdb_updated_at,
      updated_at = now()
    returning (xmax = 0) as was_insert
  )
  select count(*), count(*) filter (where was_insert)
    into v_encountered_count, v_new_ledger_rows
    from applied;

  update public.igdb_catalogue_sync set status = 'ineligible', updated_at = now()
    where igdb_id = any(p_mark_ineligible);

  update public.igdb_catalogue_discovery_cursor set
    last_igdb_id = coalesce(p_new_last_igdb_id, last_igdb_id),
    last_updated_at = coalesce(to_timestamp(p_new_last_updated_at_unix), last_updated_at),
    last_updated_at_igdb_id = coalesce(p_new_last_updated_at_igdb_id, last_updated_at_igdb_id),
    last_release_check = coalesce(to_timestamp(p_new_last_release_check_unix), last_release_check),
    last_release_check_igdb_id = coalesce(p_new_last_release_check_igdb_id, last_release_check_igdb_id),
    candidates_discovered = candidates_discovered + v_encountered_count,
    last_applied_page_key = p_page_key,
    completed_at = case when p_mark_completed then now() else completed_at end,
    updated_at = now()
  where cursor_name = p_cursor_name;

  if not found then
    raise exception 'cursor row % missing after upsert — unreachable', p_cursor_name;
  end if;

  return jsonb_build_object(
    'status', 'applied',
    'cursor_name', p_cursor_name,
    'candidates_encountered', v_encountered_count,
    'new_ledger_rows', v_new_ledger_rows
  );
end;
$$;

-- Explicit privileges ---------------------------------------------------------
-- Migration 16 (20260811140000_harden_default_privileges.sql) already
-- revoked broad default privileges (including on functions) for anon/
-- authenticated/public and altered default privileges so new objects
-- don't silently inherit Supabase's platform-wide default grant either —
-- so this function should already start with no anon/authenticated
-- access. The REVOKEs below are explicit defense-in-depth (not merely
-- defensive-in-theory: they make the intended privilege state fully
-- reviewable from this file alone, matching migration 20260813090000's
-- reorder_list_items precedent), using the complete parameter-type
-- signature on every REVOKE as well as the GRANT — never a bare function
-- name, so there is no ambiguity if an overload is ever added later.
revoke all on function public.advance_catalogue_discovery(
  text, uuid, text, text, jsonb, integer[], integer, bigint, integer, bigint, integer, boolean
) from public;
revoke all on function public.advance_catalogue_discovery(
  text, uuid, text, text, jsonb, integer[], integer, bigint, integer, bigint, integer, boolean
) from anon;
revoke all on function public.advance_catalogue_discovery(
  text, uuid, text, text, jsonb, integer[], integer, bigint, integer, bigint, integer, boolean
) from authenticated;
grant execute on function public.advance_catalogue_discovery(
  text, uuid, text, text, jsonb, integer[], integer, bigint, integer, bigint, integer, boolean
) to service_role;

-- 6. Row Level Security ---------------------------------------------------------
-- All three new tables: RLS enabled, deliberately no policy and no GRANT
-- of any kind for anon/authenticated (matching game_vector_sync's
-- existing posture) — server-only via the admin (service-role) client,
-- which bypasses RLS by Supabase's own design.
alter table public.igdb_catalogue_discovery_cursor enable row level security;
alter table public.igdb_catalogue_sync enable row level security;
alter table public.igdb_catalogue_lease enable row level security;

-- Read-only privilege assertions ------------------------------------------------
-- Fail the migration itself if the grant model above didn't take, rather
-- than applying silently-incorrect privileges — same pattern as migration
-- 20260813090000's assertions for reorder_list_items. Checks static
-- grants only, not runtime RLS row-filtering behavior.
do $$
begin
  if not has_function_privilege(
    'service_role',
    'public.advance_catalogue_discovery(text, uuid, text, text, jsonb, integer[], integer, bigint, integer, bigint, integer, boolean)',
    'execute'
  ) then
    raise exception 'service_role is missing EXECUTE on advance_catalogue_discovery';
  end if;

  if has_function_privilege(
    'anon',
    'public.advance_catalogue_discovery(text, uuid, text, text, jsonb, integer[], integer, bigint, integer, bigint, integer, boolean)',
    'execute'
  ) then
    raise exception 'anon unexpectedly has EXECUTE on advance_catalogue_discovery';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.advance_catalogue_discovery(text, uuid, text, text, jsonb, integer[], integer, bigint, integer, bigint, integer, boolean)',
    'execute'
  ) then
    raise exception 'authenticated unexpectedly has EXECUTE on advance_catalogue_discovery';
  end if;
end;
$$;
