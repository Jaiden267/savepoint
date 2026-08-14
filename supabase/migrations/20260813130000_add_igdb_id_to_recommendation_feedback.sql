-- Additive + safe: recommendation_feedback needs to record feedback for
-- catalogue-only Pinecone recommendations (no public.games row exists for
-- most of the 26,676-game Balanced catalogue). The existing game_id NOT
-- NULL FK makes this impossible today. igdb_id becomes the stable,
-- always-present cross-boundary identity; game_id is retained (now
-- nullable), populated only when a real games row already existed at the
-- moment feedback was written — never retroactively backfilled on a later
-- import (query by igdb_id for anything feedback-related, not game_id).
--
-- Written as a genuinely safe transformation regardless of whether any
-- rows currently exist (this table is confirmed unused by any application
-- code as of this migration, but the steps below don't assume that).

-- 1. Add nullable first — never touches existing rows' NOT NULL guarantee.
alter table public.recommendation_feedback add column igdb_id integer;

-- 2. Backfill every existing row from its current game_id.
update public.recommendation_feedback rf
set igdb_id = g.igdb_id
from public.games g
where rf.game_id = g.id
  and rf.igdb_id is null;

-- 3. Fail loudly — never silently delete or leave orphaned feedback — if
--    any row's game_id no longer resolves to a real games row.
do $$
declare
  missing_count integer;
begin
  select count(*) into missing_count
  from public.recommendation_feedback
  where igdb_id is null;

  if missing_count > 0 then
    raise exception
      'recommendation_feedback: % row(s) could not be backfilled with '
      'igdb_id (game_id points to a missing games row). Resolve manually '
      '— do not delete existing feedback — before re-running this migration.',
      missing_count;
  end if;
end $$;

-- 4. Only now is it safe to enforce NOT NULL going forward.
alter table public.recommendation_feedback
  alter column igdb_id set not null;

alter table public.recommendation_feedback
  add constraint recommendation_feedback_igdb_id_positive check (igdb_id > 0);

comment on column public.recommendation_feedback.igdb_id is
  'Stable cross-boundary identity — always present whether or not the '
  'game has been imported into public.games. Not a foreign key: most '
  'catalogue-only recommendation feedback references an igdb_id with no '
  'local row at all, by design (see docs/RECOMMENDATIONS.md).';

-- 5. Relax game_id — new catalogue-only feedback has none.
alter table public.recommendation_feedback
  alter column game_id drop not null;

comment on column public.recommendation_feedback.game_id is
  'Populated only when a public.games row already existed at the moment '
  'this feedback row was inserted. Null for catalogue-only feedback. '
  'Never retroactively backfilled if the game is imported later — query '
  'by igdb_id, not game_id, for anything feedback-related.';

-- 6. Fail loudly if any existing rows already violate the uniqueness the
--    new toggle index is about to enforce — never silently drop
--    duplicates as an index-creation side effect.
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count from (
    select user_id, igdb_id, event_type
    from public.recommendation_feedback
    where event_type in ('saved', 'dismissed', 'completed')
    group by user_id, igdb_id, event_type
    having count(*) > 1
  ) dupes;

  if dup_count > 0 then
    raise exception
      'recommendation_feedback: % duplicate (user_id, igdb_id, event_type) '
      'group(s) exist among saved/dismissed/completed rows. Resolve '
      'duplicates manually before re-running this migration.', dup_count;
  end if;
end $$;

-- 7. Indexes. shown/clicked stay fully unconstrained (repeated
--    impressions/clicks over time are expected and must remain
--    insertable); saved/dismissed/completed get a real partial-unique
--    constraint, enabling the same insert-then-swallow-23505 toggle
--    idempotency pattern review_likes already uses.
drop index public.recommendation_feedback_game_id_idx;
create index recommendation_feedback_game_id_idx
  on public.recommendation_feedback (game_id)
  where game_id is not null;

create index recommendation_feedback_user_igdb_idx
  on public.recommendation_feedback (user_id, igdb_id);

create unique index recommendation_feedback_toggle_unique
  on public.recommendation_feedback (user_id, igdb_id, event_type)
  where event_type in ('saved', 'dismissed', 'completed');

-- 8. Column-privilege grants are additive per role — this adds igdb_id to
--    the existing (game_id, event_type) insert grant, it doesn't replace
--    it. The existing own-rows-only SELECT/INSERT/DELETE policies are
--    unaffected by a new column (none of them reference game_id/igdb_id
--    specifically), so authenticated can still only ever read/write its
--    own rows, now including this column.
grant insert (igdb_id) on public.recommendation_feedback to authenticated;
