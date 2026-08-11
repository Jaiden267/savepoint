-- lists: user-owned, ranked or unranked, with a visibility tier.
create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  is_ranked   boolean not null default false,
  visibility  text not null default 'public' check (
    visibility in ('public', 'unlisted', 'private')
  ),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.lists.visibility is
  '''public'': shown in discovery/browse surfaces. ''unlisted'': readable by '
  'anyone with the link/id, but never surfaced in public browse queries — an '
  'application-level query concern, not an RLS distinction (both are equally '
  'readable at the database layer). ''private'': owner only.';

create index lists_user_id_idx on public.lists (user_id);
create index lists_visibility_created_idx
  on public.lists (visibility, created_at desc)
  where visibility <> 'private';

alter table public.lists enable row level security;

-- list_items: unique game per list; position is used for manual (ranked)
-- ordering and is DEFERRABLE so a drag-and-drop reorder can update several
-- rows' positions in a single transaction without a transient uniqueness
-- violation mid-batch (checked only at COMMIT).
create table public.list_items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.lists (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete restrict,
  position   integer not null,
  note       text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint list_items_list_game_key unique (list_id, game_id),
  constraint list_items_list_position_key
    unique (list_id, position) deferrable initially deferred
);

comment on column public.list_items.game_id is
  'ON DELETE RESTRICT: list items are user-curated content, same reasoning '
  'as user_games.game_id — a game deletion must not silently remove entries '
  'from someone''s list.';

create index list_items_list_position_idx on public.list_items (list_id, position);

alter table public.list_items enable row level security;

-- follows: uses a surrogate id (rather than a bare composite PK) so it has
-- the same single-column identity shape as every other entity table — in
-- particular so activity_events.object_id can reference a real follows row
-- for the follow_created event without inventing a synthetic key elsewhere.
-- The composite uniqueness/no-self-follow rules are still enforced as
-- constraints, not just via the surrogate key.
create table public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint follows_follower_following_key unique (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

comment on constraint follows_no_self_follow on public.follows is
  'Enforced as a table-level CHECK, not only via RLS WITH CHECK, so the '
  'invariant holds regardless of which role/path performs the insert.';

create index follows_following_id_idx on public.follows (following_id);
create index follows_follower_id_idx on public.follows (follower_id);

alter table public.follows enable row level security;
