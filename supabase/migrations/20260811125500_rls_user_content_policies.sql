-- RLS policies + GRANTs for user_games, diary_entries, reviews, review_likes,
-- review_comments.
--
-- Every owner-scoped table below has user_id (or user_id-equivalent) default
-- to auth.uid() at the column level (see the create-table migrations) AND
-- the INSERT grant column lists here deliberately exclude that column — a
-- client cannot supply someone else's user_id even before RLS's WITH CHECK
-- is considered, since it has no privilege to set that column at all.
-- WITH CHECK is still included on every policy as defense in depth.

-- user_games: public read (profile pages show ratings/statuses), owner-only
-- writes. See docs/DATABASE.md for why this table is public rather than
-- private-by-default.
create policy "user_games are publicly readable"
on public.user_games for select to anon, authenticated using (true);

create policy "users can insert their own user_games rows"
on public.user_games for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users can update their own user_games rows"
on public.user_games for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users can delete their own user_games rows"
on public.user_games for delete to authenticated
using (user_id = (select auth.uid()));

grant select on public.user_games to anon, authenticated;
grant insert (game_id, status, rating) on public.user_games to authenticated;
grant update (status, rating) on public.user_games to authenticated;
grant delete on public.user_games to authenticated;

-- diary_entries: same shape as user_games.
create policy "diary_entries are publicly readable"
on public.diary_entries for select to anon, authenticated using (true);

create policy "users can insert their own diary_entries"
on public.diary_entries for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users can update their own diary_entries"
on public.diary_entries for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users can delete their own diary_entries"
on public.diary_entries for delete to authenticated
using (user_id = (select auth.uid()));

grant select on public.diary_entries to anon, authenticated;
grant insert (game_id, played_on, rating, is_replay, note) on public.diary_entries to authenticated;
grant update (played_on, rating, is_replay, note) on public.diary_entries to authenticated;
grant delete on public.diary_entries to authenticated;

-- reviews: explicitly required to be publicly readable.
create policy "reviews are publicly readable"
on public.reviews for select to anon, authenticated using (true);

create policy "users can insert their own reviews"
on public.reviews for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users can update their own reviews"
on public.reviews for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users can delete their own reviews"
on public.reviews for delete to authenticated
using (user_id = (select auth.uid()));

grant select on public.reviews to anon, authenticated;
grant insert (game_id, rating, body, has_spoilers) on public.reviews to authenticated;
grant update (rating, body, has_spoilers) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

-- review_likes: public read (for like counts), owner can create/delete their
-- own like. No UPDATE policy or grant — a like is binary, not editable.
create policy "review_likes are publicly readable"
on public.review_likes for select to anon, authenticated using (true);

create policy "users can like reviews as themselves"
on public.review_likes for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users can remove their own like"
on public.review_likes for delete to authenticated
using (user_id = (select auth.uid()));

grant select on public.review_likes to anon, authenticated;
grant insert (review_id) on public.review_likes to authenticated;
grant delete on public.review_likes to authenticated;

-- review_comments: public read, owner-only writes.
create policy "review_comments are publicly readable"
on public.review_comments for select to anon, authenticated using (true);

create policy "users can insert their own comments"
on public.review_comments for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users can update their own comments"
on public.review_comments for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users can delete their own comments"
on public.review_comments for delete to authenticated
using (user_id = (select auth.uid()));

grant select on public.review_comments to anon, authenticated;
grant insert (review_id, body) on public.review_comments to authenticated;
grant update (body) on public.review_comments to authenticated;
grant delete on public.review_comments to authenticated;
