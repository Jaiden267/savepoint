-- Extensions used across the Savepoint schema.
--
-- citext: case-insensitive text, used for profiles.username / games.slug /
--   genres.slug / platforms.slug uniqueness.
-- pg_trgm: trigram indexes for fast search-as-you-type (ILIKE / similarity)
--   on games.name and profiles.username.
--
-- Installed into the "extensions" schema (Supabase convention) rather than
-- "public", and referenced schema-qualified (extensions.citext,
-- extensions.gin_trgm_ops) everywhere in later migrations rather than relying
-- on search_path — this keeps the SQL correct regardless of the target
-- project's configured search_path.
--
-- No pgcrypto needed: gen_random_uuid() has been a built-in pg_catalog
-- function since PostgreSQL 13 (this project targets Postgres 17, per
-- supabase/config.toml), so no extension is required for UUID generation.
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
