-- Generic BEFORE UPDATE trigger: stamps updated_at = now() on every row
-- update. Deliberately NOT SECURITY DEFINER — it runs as the invoking role,
-- which is fine since it only touches the row already being updated under
-- that role's own RLS-approved UPDATE; there is no privilege boundary to
-- cross here (unlike handle_new_user() or the activity_events triggers).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at = now(). Runs as '
  'invoker, not SECURITY DEFINER — no privilege escalation is needed here.';

-- Applied explicitly (not via a dynamic loop) to exactly the tables that have
-- an updated_at column, so this list is reviewable at a glance: profiles,
-- games, user_games, diary_entries, reviews, review_comments, lists,
-- list_items, game_vector_sync. Pure log/join/reference tables (genres,
-- platforms, game_genres, game_platforms, review_likes, follows,
-- activity_events, recommendation_feedback) have no updated_at column and no
-- trigger — they are insert/delete-only, never updated in place.
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.games
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.user_games
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.diary_entries
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.review_comments
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.lists
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.list_items
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.game_vector_sync
  for each row execute function public.set_updated_at();
