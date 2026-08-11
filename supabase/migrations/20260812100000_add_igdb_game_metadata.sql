-- Adds the IGDB metadata that games.* couldn't carry yet: game modes,
-- themes, keywords, involved companies, website links, and edition/version
-- info. Combined migration (columns + new reference tables + RLS + grants
-- together) — same precedent as 20260812090000_add_onboarding_completed_to_profiles.sql
-- for a small additive change. Applied manually by the project owner via the
-- Supabase CLI, per this project's established migration workflow — not
-- applied by this migration file's mere existence in the repo.

-- game_modes / themes: reference data, exact mirror of the existing
-- genres/platforms pattern (IGDB's own numeric id reused directly as PK).
-- Populated by the IGDB integration's game-sync path; empty until then.
create table public.game_modes (
  id   integer primary key,
  name text not null,
  slug extensions.citext not null,
  constraint game_modes_slug_key unique (slug)
);
alter table public.game_modes enable row level security;

create table public.themes (
  id   integer primary key,
  name text not null,
  slug extensions.citext not null,
  constraint themes_slug_key unique (slug)
);
alter table public.themes enable row level security;

-- game_game_modes / game_themes: pure join tables, cascade both directions —
-- same reasoning as game_genres/game_platforms (categorization metadata, no
-- standalone value, safe to clean up with either side).
create table public.game_game_modes (
  game_id      uuid not null references public.games (id) on delete cascade,
  game_mode_id integer not null references public.game_modes (id) on delete cascade,
  primary key (game_id, game_mode_id)
);
create index game_game_modes_game_mode_id_idx on public.game_game_modes (game_mode_id);
alter table public.game_game_modes enable row level security;

create table public.game_themes (
  game_id  uuid not null references public.games (id) on delete cascade,
  theme_id integer not null references public.themes (id) on delete cascade,
  primary key (game_id, theme_id)
);
create index game_themes_theme_id_idx on public.game_themes (theme_id);
alter table public.game_themes enable row level security;

-- games: new columns, all nullable/defaulted (additive only, no existing
-- row is affected).
alter table public.games
  add column igdb_game_type_id smallint,
  add column igdb_game_type text,
  add column version_parent_igdb_id integer,
  add column keywords text[] not null default '{}',
  add column developer_names text[] not null default '{}',
  add column publisher_names text[] not null default '{}',
  add column websites jsonb not null default '[]'::jsonb;

comment on column public.games.igdb_game_type_id is
  'IGDB''s games.game_type field: a scalar reference id into the game_types '
  'endpoint. No FK — that endpoint is not a table this project manages, only '
  'a lookup Savepoint resolves at fetch time via Apicalypse dot-expansion '
  '(game_type.type) in the same request. Stored for provenance only.';

comment on column public.games.igdb_game_type is
  'The resolved game_type.type string (e.g. main_game, dlc_addon, '
  'expansion, bundle, standalone_expansion, mod, episode, season, remake, '
  'remaster, expanded_game, port, fork, pack, update — current as of '
  'writing, not exhaustive). Deliberately NOT a closed CHECK enum: IGDB''s '
  'game_types is a live, data-driven reference table IGDB can extend, and '
  'games.category (the old fixed 0-14 numeric enum this replaces) is '
  'deprecated and intentionally not used anywhere in this schema or app.';

comment on column public.games.version_parent_igdb_id is
  'IGDB''s games.version_parent field — the IGDB id of the canonical game '
  'this row is an edition/version of, if any. No FK (the parent may never '
  'be imported into this cache). Used only for search ranking/suppression, '
  'never for referential integrity.';

comment on column public.games.websites is
  'Curated, allow-listed website links: [{"type": string, "url": string}], '
  'capped at 8. "type" is the resolved website_types.type string (via '
  'websites.type.type dot-expansion) — NOT the deprecated websites.category '
  'numeric enum, which this project does not read or store. Only a small '
  'allow-list of useful types is kept at mapping time (official, steam, '
  'gog, epicgames, wikipedia, twitter/x); everything else is dropped before '
  'this column is ever written.';

alter table public.games
  add constraint games_igdb_game_type_length check (
    igdb_game_type is null or char_length(igdb_game_type) <= 40
  ),
  add constraint games_keywords_length check (
    array_length(keywords, 1) is null or array_length(keywords, 1) <= 10
  ),
  add constraint games_developer_names_length check (
    array_length(developer_names, 1) is null or array_length(developer_names, 1) <= 10
  ),
  add constraint games_publisher_names_length check (
    array_length(publisher_names, 1) is null or array_length(publisher_names, 1) <= 10
  ),
  add constraint games_websites_length check (
    jsonb_array_length(websites) <= 8
  );

-- Grants ----------------------------------------------------------------
--
-- `grant select on public.games to anon, authenticated;` already exists
-- (migrations 11 and 16) and is a TABLE-level grant with no column list —
-- PostgreSQL only narrows column access when a grant is itself
-- column-scoped (like `grant update (username, display_name, bio,
-- avatar_path) on public.profiles`, which this one never was). A
-- table-level SELECT grant automatically covers every column added here via
-- ALTER TABLE ADD COLUMN with no further action needed. Re-asserted below
-- anyway, harmless and idempotent, so this migration remains a complete,
-- self-contained statement of the resulting privilege state without asking
-- a future reader to independently reason about implicit column
-- inheritance — matching this project's established practice from
-- migration 16.
grant select on public.games to anon, authenticated;

-- game_modes/themes/game_game_modes/game_themes are NEW tables, created
-- after migration 16's
--   alter default privileges in schema public revoke all on tables from anon, authenticated, public;
-- That revocation applies to future objects too, so Supabase's usual broad
-- default grant will NOT apply to these four tables. Without the explicit
-- grants below, they would have zero access for anon/authenticated
-- (correctly fail-closed, but useless) — these grants are required, not
-- just defensive.
grant select on public.game_modes to anon, authenticated;
grant select on public.themes to anon, authenticated;
grant select on public.game_game_modes to anon, authenticated;
grant select on public.game_themes to anon, authenticated;

-- RLS policies ------------------------------------------------------------
-- Public read, no write policy of any kind — exact mirror of
-- genres/platforms/game_genres/game_platforms (20260811125000_rls_reference_data_policies.sql).
-- All writes happen via the service-role game-sync path
-- (src/lib/supabase/admin.ts), which bypasses RLS and GRANTs entirely.
create policy "game_modes are publicly readable"
on public.game_modes for select to anon, authenticated using (true);

create policy "themes are publicly readable"
on public.themes for select to anon, authenticated using (true);

create policy "game_game_modes are publicly readable"
on public.game_game_modes for select to anon, authenticated using (true);

create policy "game_themes are publicly readable"
on public.game_themes for select to anon, authenticated using (true);
