-- user_games: the core per-user/per-game row — status tracking + optional
-- personal rating. user_id defaults to auth.uid() and (see the RLS policies
-- migration) clients are never granted INSERT privilege on the user_id
-- column itself, so a client literally cannot supply someone else's user_id
-- even before RLS's WITH CHECK is considered — defense in depth, not just a
-- policy predicate.
create table public.user_games (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete restrict,
  status     text not null check (
    status in ('wishlist', 'backlog', 'playing', 'completed', 'paused', 'dropped')
  ),
  rating     smallint check (rating between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_games_user_game_key unique (user_id, game_id)
);

comment on column public.user_games.rating is
  'Integer 1-10, displayed in the UI as 0.5-5.0 stars (stars = rating / 2). '
  'src/lib/rating.ts is the single source of this conversion — every rating '
  'column in this schema must use the same 1-10 CHECK range.';

comment on column public.user_games.game_id is
  'ON DELETE RESTRICT, not CASCADE: games are an anchor for user-authored '
  'content. Deleting a game must never silently wipe a user''s rating/status '
  'history for it — that has to be a conscious, separate decision.';

create index user_games_user_status_idx on public.user_games (user_id, status);
create index user_games_game_id_idx on public.user_games (game_id);
create index user_games_user_updated_idx on public.user_games (user_id, updated_at desc);

alter table public.user_games enable row level security;

-- diary_entries: unlike user_games/reviews, many rows are allowed per
-- user/game (repeat playthroughs). No unique(user_id, game_id).
create table public.diary_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete restrict,
  played_on  date not null default current_date,
  rating     smallint check (rating between 1 and 10),
  is_replay  boolean not null default false,
  note       text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.diary_entries is
  'Multiple play logs are allowed per user/game (unlike user_games and '
  'reviews, which are capped at one row per user/game).';

create index diary_entries_user_played_idx on public.diary_entries (user_id, played_on desc);
create index diary_entries_game_id_idx on public.diary_entries (game_id);

alter table public.diary_entries enable row level security;

-- reviews: at most one primary review per user/game, enforced by the unique
-- constraint below. rating is required here (unlike user_games/diary_entries,
-- where it's explicitly optional) — a published review always carries a score.
create table public.reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id      uuid not null references public.games (id) on delete restrict,
  rating       smallint not null check (rating between 1 and 10),
  body         text not null check (char_length(body) between 1 and 10000),
  has_spoilers boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint reviews_user_game_key unique (user_id, game_id)
);

comment on constraint reviews_user_game_key on public.reviews is
  'At most one primary review per user/game — repeat play-logs belong in '
  'diary_entries instead.';

create index reviews_game_created_idx on public.reviews (game_id, created_at desc);
create index reviews_user_created_idx on public.reviews (user_id, created_at desc);

alter table public.reviews enable row level security;

-- review_likes: binary like/unlike, no update semantics.
create table public.review_likes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  review_id  uuid not null references public.reviews (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, review_id)
);
create index review_likes_review_id_idx on public.review_likes (review_id);
alter table public.review_likes enable row level security;

-- review_comments
create table public.review_comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  review_id  uuid not null references public.reviews (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index review_comments_review_created_idx on public.review_comments (review_id, created_at);
create index review_comments_user_id_idx on public.review_comments (user_id);
alter table public.review_comments enable row level security;
