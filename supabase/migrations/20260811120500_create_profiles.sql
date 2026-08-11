-- profiles: one row per auth.users user. Created exclusively by the
-- handle_new_user() trigger (see profile_bootstrap_trigger migration) — there
-- is no client-facing INSERT path, by design (see RLS policies migration).
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     extensions.citext not null,
  display_name text,
  bio          text,
  avatar_path  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_username_key unique (username),
  constraint profiles_username_format check (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  constraint profiles_display_name_length check (
    display_name is null or char_length(display_name) <= 80
  ),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 500)
);

comment on table public.profiles is
  'One row per auth.users user. id is never independently insertable by '
  'clients — rows are bootstrapped by the handle_new_user() trigger. '
  'username uniqueness is case-insensitive via the citext column type.';

comment on column public.profiles.avatar_path is
  'Object path within the "avatars" storage bucket (e.g. "<uid>/avatar.webp"), '
  'never a signed or public URL. Resolved client-side via '
  'supabase.storage.from(''avatars'').getPublicUrl(avatar_path).';

-- Supports profile search-as-you-type (ILIKE / similarity) on username.
-- Explicitly cast to text: pg_trgm's gin_trgm_ops operator class is defined
-- for text, and binding it directly to a citext column is not a safe/
-- guaranteed match — the cast removes any ambiguity. Queries that want this
-- index used should match the same expression, e.g.
-- `where username::text ilike '%term%'`.
create index profiles_username_trgm_idx
  on public.profiles using gin ((username::text) extensions.gin_trgm_ops);

-- RLS is enabled the instant the table exists, before any policy is defined,
-- so there is never a window where a freshly created table is openly
-- accessible. Policies are added later in the rls_reference_data_policies
-- migration, once every table in this pass exists and can be reviewed as a
-- group.
alter table public.profiles enable row level security;
