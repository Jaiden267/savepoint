-- Rating-aggregate and profile-stat views. All are `security_invoker = true`
-- (the Postgres/Supabase opt-in for "run this view under the CALLER's RLS,
-- not the view owner's") — deliberately not SECURITY DEFINER, and there is
-- no denormalized/stored aggregate column anywhere in this schema. A plain
-- invoker-rights view re-runs its query as the calling role, so it can only
-- ever surface what that role could already see by querying the base tables
-- directly — safe by construction, with zero leak risk and zero drift risk
-- (nothing to keep in sync via triggers). This works specifically because
-- user_games and review_likes are themselves publicly SELECT-able (see the
-- RLS policies migration) — if either were private, this view shape would
-- need to become SECURITY DEFINER, which is deliberately avoided here.
--
-- A stored/materialized aggregate is a legitimate later optimization if a
-- hot-path query ever needs it, driven by real profiling — not a default for
-- this migration.

create view public.game_rating_stats
with (security_invoker = true) as
select
  game_id,
  round(avg(rating)::numeric, 2) as average_rating,
  count(rating) as rating_count
from public.user_games
where rating is not null
group by game_id;

comment on view public.game_rating_stats is
  'Computed live from user_games under the caller''s own RLS (security_invoker) — '
  'safe because user_games is publicly readable, so nothing here is visible '
  'that a caller could not already see by querying user_games directly.';

create view public.review_like_counts
with (security_invoker = true) as
select review_id, count(*) as like_count
from public.review_likes
group by review_id;

create view public.profile_stats
with (security_invoker = true) as
select
  p.id as user_id,
  count(distinct ug.id) filter (where ug.status = 'completed') as games_completed,
  count(distinct r.id) as review_count,
  count(distinct l.id) as list_count,
  (select count(*) from public.follows f where f.following_id = p.id) as follower_count,
  (select count(*) from public.follows f where f.follower_id = p.id) as following_count
from public.profiles p
left join public.user_games ug on ug.user_id = p.id
left join public.reviews r on r.user_id = p.id
left join public.lists l on l.user_id = p.id
group by p.id;

comment on view public.profile_stats is
  'list_count reflects only lists visible to the querying role under lists'' '
  'own RLS (security_invoker): a non-owner querying another user''s '
  'profile_stats sees a lower list_count that silently excludes that user''s '
  'private lists — this is correct and deliberate, the view must never leak '
  'private-list existence via a raw count.';

grant select on public.game_rating_stats to anon, authenticated;
grant select on public.review_like_counts to anon, authenticated;
grant select on public.profile_stats to anon, authenticated;
