-- Trigger functions that write activity_events as an atomic side effect of a
-- real mutation on the source tables. This is the entire anti-forgery
-- mechanism (activity_events itself has no INSERT policy/GRANT for clients —
-- see the RLS policies migration): a feed row is impossible to create
-- without the underlying action actually happening, in the same transaction,
-- and impossible to skip by forgetting to call something.
--
-- Each function is SECURITY DEFINER with a locked search_path (same
-- rationale as handle_new_user() in the previous migration) and has EXECUTE
-- revoked from PUBLIC — only its own trigger invokes it.
--
-- Hard invariant, repeated from the activity_events table comment: a trigger
-- must NEVER log an event about content that is not itself publicly visible.
-- activity_events' SELECT policy is public, so this is what keeps that safe.
-- Of the five triggers below, only fn_log_list_activity has a visibility
-- gate to enforce (private lists must not appear in the public feed) — the
-- other four source tables are already fully public per their own RLS.

-- reviews -> review_published
create or replace function public.fn_log_review_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_events (actor_id, event_type, object_type, object_id, game_id, metadata)
  values (
    new.user_id,
    'review_published',
    'review',
    new.id,
    new.game_id,
    jsonb_build_object('rating', new.rating, 'has_spoilers', new.has_spoilers)
  );
  return new;
end;
$$;
revoke all on function public.fn_log_review_activity() from public;

create trigger trg_log_review_activity
  after insert on public.reviews
  for each row execute function public.fn_log_review_activity();

-- user_games -> game_rated (rating newly set/changed) and/or
--               game_completed (status transitions to 'completed')
-- Branches explicitly on TG_OP rather than unconditionally referencing OLD,
-- since OLD is not a valid record on INSERT — this avoids any reliance on
-- AND/OR short-circuit evaluation order for correctness.
create or replace function public.fn_log_user_game_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rating_changed boolean;
  status_changed boolean;
begin
  if tg_op = 'INSERT' then
    rating_changed := new.rating is not null;
    status_changed := new.status = 'completed';
  else
    rating_changed := new.rating is not null and old.rating is distinct from new.rating;
    status_changed := new.status = 'completed' and old.status is distinct from new.status;
  end if;

  if rating_changed then
    insert into public.activity_events (actor_id, event_type, object_type, object_id, game_id, metadata)
    values (new.user_id, 'game_rated', 'user_game', new.id, new.game_id, jsonb_build_object('rating', new.rating));
  end if;

  if status_changed then
    insert into public.activity_events (actor_id, event_type, object_type, object_id, game_id, metadata)
    values (new.user_id, 'game_completed', 'user_game', new.id, new.game_id, '{}'::jsonb);
  end if;

  return new;
end;
$$;
revoke all on function public.fn_log_user_game_activity() from public;

create trigger trg_log_user_game_activity
  after insert or update on public.user_games
  for each row execute function public.fn_log_user_game_activity();

-- diary_entries -> diary_entry_logged
create or replace function public.fn_log_diary_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_events (actor_id, event_type, object_type, object_id, game_id, metadata)
  values (
    new.user_id,
    'diary_entry_logged',
    'diary_entry',
    new.id,
    new.game_id,
    jsonb_build_object('played_on', new.played_on, 'is_replay', new.is_replay)
  );
  return new;
end;
$$;
revoke all on function public.fn_log_diary_activity() from public;

create trigger trg_log_diary_activity
  after insert on public.diary_entries
  for each row execute function public.fn_log_diary_activity();

-- lists -> list_created, ONLY for non-private lists. This is the one trigger
-- with a visibility gate — see the hard invariant at the top of this file.
create or replace function public.fn_log_list_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.visibility <> 'private' then
    insert into public.activity_events (actor_id, event_type, object_type, object_id, metadata)
    values (
      new.user_id,
      'list_created',
      'list',
      new.id,
      jsonb_build_object('title', new.title, 'is_ranked', new.is_ranked)
    );
  end if;
  return new;
end;
$$;
revoke all on function public.fn_log_list_activity() from public;

create trigger trg_log_list_activity
  after insert on public.lists
  for each row execute function public.fn_log_list_activity();

-- follows -> follow_created. follows rows are already fully public (see the
-- RLS policies migration), so no gating is needed.
create or replace function public.fn_log_follow_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_events (actor_id, event_type, object_type, object_id, metadata)
  values (
    new.follower_id,
    'follow_created',
    'follow',
    new.id,
    jsonb_build_object('following_id', new.following_id)
  );
  return new;
end;
$$;
revoke all on function public.fn_log_follow_activity() from public;

create trigger trg_log_follow_activity
  after insert on public.follows
  for each row execute function public.fn_log_follow_activity();
