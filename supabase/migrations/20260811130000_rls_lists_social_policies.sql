-- RLS policies + GRANTs for lists, list_items, follows.

-- lists: public/unlisted are readable by anyone; private only by the owner.
-- "Unlisted" is equivalent to "public" at the RLS layer (readable if you have
-- the id/link) — the app is responsible for excluding unlisted lists from
-- public browse/discovery queries; that is a query-shaping concern, not an
-- access-control one.
create policy "lists follow their visibility"
on public.lists for select
to anon, authenticated
using (visibility in ('public', 'unlisted') or user_id = (select auth.uid()));

create policy "users can insert their own lists"
on public.lists for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users can update their own lists"
on public.lists for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users can delete their own lists"
on public.lists for delete to authenticated
using (user_id = (select auth.uid()));

grant select on public.lists to anon, authenticated;
grant insert (title, description, is_ranked, visibility) on public.lists to authenticated;
grant update (title, description, is_ranked, visibility) on public.lists to authenticated;
grant delete on public.lists to authenticated;

-- list_items: no user_id column of its own — visibility and ownership both
-- follow the parent list via an EXISTS check.
create policy "list_items follow their parent list visibility"
on public.list_items for select
to anon, authenticated
using (
  exists (
    select 1 from public.lists l
    where l.id = list_items.list_id
      and (l.visibility in ('public', 'unlisted') or l.user_id = (select auth.uid()))
  )
);

create policy "owners can insert items into their own lists"
on public.list_items for insert to authenticated
with check (
  exists (
    select 1 from public.lists l
    where l.id = list_items.list_id and l.user_id = (select auth.uid())
  )
);

create policy "owners can update items in their own lists"
on public.list_items for update to authenticated
using (
  exists (
    select 1 from public.lists l
    where l.id = list_items.list_id and l.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.lists l
    where l.id = list_items.list_id and l.user_id = (select auth.uid())
  )
);

create policy "owners can delete items from their own lists"
on public.list_items for delete to authenticated
using (
  exists (
    select 1 from public.lists l
    where l.id = list_items.list_id and l.user_id = (select auth.uid())
  )
);

grant select on public.list_items to anon, authenticated;
grant insert (list_id, game_id, position, note) on public.list_items to authenticated;
grant update (position, note) on public.list_items to authenticated;
grant delete on public.list_items to authenticated;

-- follows: publicly readable (follower/following counts + lists), owner
-- controls only their own outgoing follow rows. No UPDATE policy or grant —
-- a follow is created or removed, never edited.
create policy "follows are publicly readable"
on public.follows for select to anon, authenticated using (true);

create policy "users can follow as themselves"
on public.follows for insert to authenticated
with check (follower_id = (select auth.uid()));

create policy "users can unfollow as themselves"
on public.follows for delete to authenticated
using (follower_id = (select auth.uid()));

grant select on public.follows to anon, authenticated;
grant insert (following_id) on public.follows to authenticated;
grant delete on public.follows to authenticated;
