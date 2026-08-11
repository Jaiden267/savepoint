-- handle_new_user(): creates the corresponding public.profiles row whenever
-- a new auth.users row is inserted (i.e. on signup). Derives a candidate
-- username from the email local-part, stripped to [a-zA-Z0-9_], and appends a
-- numeric suffix on collision.
--
-- SECURITY DEFINER is required here: the trigger runs in the context of the
-- signup itself, before any authenticated session exists for the new user,
-- and profiles has no client-facing INSERT policy at all (see the RLS
-- policies migration) — so this function must run as its owner to succeed.
--
-- search_path is locked to `public, pg_temp` to close the classic
-- SECURITY DEFINER privilege-escalation hole: without a locked search_path,
-- a role with schema-creation privileges could create an object (e.g. a
-- function or table) earlier in an attacker-controlled search_path that
-- shadows `public.profiles` and gets executed with this function's elevated
-- privileges instead. EXECUTE is revoked from PUBLIC afterward — only the
-- trigger itself needs to invoke it (triggers always run as the function's
-- owner regardless of who fired the triggering statement).
--
-- Known, accepted limitation: the collision check-then-insert is not fully
-- race-safe under concurrent signups picking the same base username at the
-- same instant (a narrow TOCTOU window). The profiles_username_key unique
-- constraint is the backstop — a genuine collision fails the signup with a
-- clear constraint-violation error rather than silently creating a duplicate.
-- A stricter fix (advisory lock or INSERT ... ON CONFLICT retry loop) can be
-- added later if this proves to matter in practice.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_username      text;
  candidate_username extensions.citext;
  suffix             int := 0;
begin
  base_username := coalesce(
    nullif(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'), ''),
    'user'
  );
  base_username := left(base_username, 24);
  if char_length(base_username) < 3 then
    base_username := rpad(base_username, 3, '0');
  end if;

  candidate_username := base_username;

  while exists (
    select 1 from public.profiles p where p.username = candidate_username
  ) loop
    suffix := suffix + 1;
    candidate_username := left(base_username, 24) || suffix::text;
  end loop;

  insert into public.profiles (id, username)
  values (new.id, candidate_username);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

comment on function public.handle_new_user() is
  'SECURITY DEFINER, locked search_path — bootstraps a profiles row on '
  'signup. See inline migration comments for the full rationale.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
