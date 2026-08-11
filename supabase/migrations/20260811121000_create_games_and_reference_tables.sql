-- games: Supabase cache of IGDB game data. Populated/refreshed by the
-- server-only game-sync service (IGDB integration milestone) via the
-- service-role client — never written by a normal user session.
--
-- Deliberately no raw IGDB JSON payload column: only the specific fields the
-- app actually renders are stored, keeping rows small and avoiding re-shipping
-- IGDB's full response shape as part of this schema.
create table public.games (
  id                            uuid primary key default gen_random_uuid(),
  igdb_id                       integer not null,
  slug                          extensions.citext not null,
  name                          text not null,
  summary                       text,
  storyline                     text,
  release_date                  date,
  cover_image_id                text,
  screenshot_image_ids          text[] not null default '{}',
  artwork_image_ids             text[] not null default '{}',
  igdb_rating                   numeric(5, 2),
  igdb_rating_count             integer,
  igdb_aggregated_rating        numeric(5, 2),
  igdb_aggregated_rating_count  integer,
  igdb_synced_at                timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint games_igdb_id_key unique (igdb_id),
  constraint games_slug_key unique (slug),
  constraint games_slug_not_empty check (char_length(slug) > 0),
  constraint games_name_not_empty check (char_length(name) > 0),
  constraint games_igdb_rating_range check (
    igdb_rating is null or (igdb_rating between 0 and 100)
  ),
  constraint games_igdb_aggregated_rating_range check (
    igdb_aggregated_rating is null or (igdb_aggregated_rating between 0 and 100)
  )
);

comment on table public.games is
  'Supabase cache of IGDB game data, keyed internally by a UUID (not the IGDB '
  'id) so every other table has a stable, database-native reference. '
  'igdb_rating* columns cache IGDB''s own community/critic scores as of '
  'igdb_synced_at — they are a cache of an external source, not a local '
  'aggregate, so there is no local drift risk the way a derived value would have.';

comment on column public.games.cover_image_id is
  'IGDB image id only (e.g. "co1wyy") — resolved to a CDN URL client-side. '
  'No game-art storage bucket exists in this project; artwork stays external.';

create index games_name_trgm_idx
  on public.games using gin (name extensions.gin_trgm_ops);
create index games_release_date_idx on public.games (release_date);

alter table public.games enable row level security;

-- genres / platforms: reference data. IGDB's own numeric ids are reused
-- directly as the primary key (stable, externally defined, no reason to
-- introduce a surrogate UUID). Populated by the IGDB integration milestone;
-- intentionally empty as of this migration.
create table public.genres (
  id   integer primary key,
  name text not null,
  slug extensions.citext not null,
  constraint genres_slug_key unique (slug)
);
alter table public.genres enable row level security;

create table public.platforms (
  id   integer primary key,
  name text not null,
  slug extensions.citext not null,
  constraint platforms_slug_key unique (slug)
);
alter table public.platforms enable row level security;

-- game_genres / game_platforms: pure join tables. ON DELETE CASCADE in both
-- directions here is deliberately different from the RESTRICT used on
-- user_games/diary_entries/reviews/list_items below — these rows are only
-- categorization metadata with no standalone value, not user-authored
-- content, so cascading cleanup alongside either side is correct and safe.
create table public.game_genres (
  game_id  uuid not null references public.games (id) on delete cascade,
  genre_id integer not null references public.genres (id) on delete cascade,
  primary key (game_id, genre_id)
);
create index game_genres_genre_id_idx on public.game_genres (genre_id);
alter table public.game_genres enable row level security;

create table public.game_platforms (
  game_id     uuid not null references public.games (id) on delete cascade,
  platform_id integer not null references public.platforms (id) on delete cascade,
  primary key (game_id, platform_id)
);
create index game_platforms_platform_id_idx on public.game_platforms (platform_id);
alter table public.game_platforms enable row level security;
