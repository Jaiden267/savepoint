-- RLS policies + GRANTs for profiles, games, genres, platforms, game_genres,
-- game_platforms.
--
-- Two independent gates apply to every table below: an RLS policy (this
-- file) AND an explicit GRANT. supabase/config.toml does not set
-- auto_expose_new_tables, so a table is unreachable through PostgREST (i.e.
-- through src/lib/supabase/client.ts / server.ts on the publishable key) even
-- if a permissive RLS policy exists, until it is also explicitly GRANTed —
-- a second, independently fail-closed layer. service_role
-- (src/lib/supabase/admin.ts) bypasses both by default and needs no grants
-- here.

-- profiles: public read; a user may update only a fixed set of their own
-- columns. No INSERT policy — rows are created exclusively by the
-- handle_new_user() trigger (SECURITY DEFINER, profile_bootstrap_trigger
-- migration), which bypasses RLS as the function owner; clients must never
-- be able to create a profiles row detached from a real auth.users id. No
-- DELETE policy — profile removal follows auth.users deletion via
-- ON DELETE CASCADE, never a direct client delete.
create policy "profiles are publicly readable"
on public.profiles for select
to anon, authenticated
using (true);

create policy "users can update their own profile"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

grant select on public.profiles to anon, authenticated;
-- Column-level grant: even on their own row, a client may only ever set
-- these four columns — never id or created_at. updated_at is separately
-- overwritten unconditionally by the set_updated_at trigger regardless of
-- what, if anything, a client sends for it.
grant update (username, display_name, bio, avatar_path) on public.profiles to authenticated;

-- games / genres / platforms / game_genres / game_platforms: public read.
-- No write policy of any kind for anon/authenticated on any of these five —
-- all writes happen via the service-role game-sync path
-- (src/lib/supabase/admin.ts, wired up in the IGDB integration milestone),
-- which bypasses RLS and GRANTs entirely.
create policy "games are publicly readable"
on public.games for select to anon, authenticated using (true);

create policy "genres are publicly readable"
on public.genres for select to anon, authenticated using (true);

create policy "platforms are publicly readable"
on public.platforms for select to anon, authenticated using (true);

create policy "game_genres are publicly readable"
on public.game_genres for select to anon, authenticated using (true);

create policy "game_platforms are publicly readable"
on public.game_platforms for select to anon, authenticated using (true);

grant select on public.games to anon, authenticated;
grant select on public.genres to anon, authenticated;
grant select on public.platforms to anon, authenticated;
grant select on public.game_genres to anon, authenticated;
grant select on public.game_platforms to anon, authenticated;
