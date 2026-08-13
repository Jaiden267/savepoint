# Environment variables

Names and purposes only — **never** put real values in this file, `.env.example`,
source code, commit messages, or logs. Copy `.env.example` to `.env.local` and
fill in real values there; `.env.local` is gitignored.

## Client-safe (`NEXT_PUBLIC_*`, inlined into the browser bundle at build time)

| Variable                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL, used by the browser and SSR Supabase clients.                                                                                                                                                                                                                                                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key. Safe for the browser — all access it grants is still subject to Row Level Security. **Not** the legacy anon key.                                                                                                                                                                                                                                                                         |
| `NEXT_PUBLIC_APP_URL`                  | The app's own public origin (e.g. for building absolute links/redirects, OAuth callback URLs, metadata). Defaults to `http://localhost:3000`. Must match Supabase Auth's **Site URL**/**Redirect URLs** — it's the domain `/auth/callback` and the rest of this app are actually served from, not necessarily the same as any dedicated email-sending domain (see docs/AUTH.md's Dashboard configuration section). |

## Server-only (never sent to the browser)

| Variable              | Purpose                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_SECRET_KEY` | Bypasses Row Level Security. Used **only** in explicit administrative server modules (`src/lib/supabase/admin.ts`) — never for normal user CRUD. |
| `IGDB_CLIENT_ID`      | Twitch application client ID, used to obtain an IGDB API access token.                                                                           |
| `IGDB_CLIENT_SECRET`  | Twitch application client secret, paired with `IGDB_CLIENT_ID`.                                                                                  |
| `PINECONE_API_KEY`    | Authenticates all Pinecone requests (index bootstrap, upsert, search).                                                                           |
| `PINECONE_INDEX_NAME` | Name of the Pinecone index used for game search/recommendations. Defaults to `savepoint-games`.                                                  |
| `ADMIN_USER_IDS`      | Optional, comma-separated Supabase user IDs granted access to `/admin` and sync tooling. Empty by default (no admins).                           |
| `CRON_SECRET`         | Optional. Guards the scheduled cache/index refresh endpoint once it exists. Not required for the foundation stage.                               |

## Explicitly not used

`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are legacy
Supabase variable names and are intentionally not read anywhere in this
project. Use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`
instead.

## Validation

- `src/lib/env.ts` — validates the client-safe variables (Zod). Safe to import
  from Client or Server Components.
- `src/lib/env.server.ts` — validates the server-only variables (Zod), guarded
  by `import "server-only"` so an accidental import from a Client Component
  fails the build. Import only from server-side modules.
- `npm run check-env` — reports **SET / MISSING** for each contract variable.
  It never prints, logs, or otherwise exposes a value.

Both modules fail fast (throw) on missing/invalid variables, naming only the
variable that's wrong — never its value.
