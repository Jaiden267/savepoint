# Savepoint

A Letterboxd-style social platform for video games: track your backlog, rate
and review games, keep a play diary, follow friends, and get semantic search +
recommendations that explain themselves.

Built with Next.js (App Router) + Supabase + IGDB + Pinecone. Ships as a
standalone Docker container for ZimaOS; runs locally on Windows in development.

> Status: **foundation scaffold**. Features arrive across later milestones (see
> the implementation plan). Database schema + RLS land in the next prompt.

## Prerequisites

- **Node.js 24 LTS** (see `.nvmrc`)
- **npm** (uses `package-lock.json`)
- A Supabase project, IGDB/Twitch credentials, and a Pinecone account
- Supabase CLI is bundled as a dev dependency (`npx supabase ...`)

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in real values (never commit them)
npm run check-env            # reports SET / MISSING only, never values
npm run dev                  # http://localhost:3000
```

Health check: `GET /api/health` returns `{ "status": "ok", ... }`.

## Environment variables

See `.env.example` for the full contract. Client-safe values are prefixed
`NEXT_PUBLIC_`; everything else is server-only and must never reach the browser.

| Variable                                | Scope  | Notes                                                    |
| --------------------------------------- | ------ | -------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`              | client | required                                                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | client | required (publishable key, not the anon key)             |
| `NEXT_PUBLIC_APP_URL`                   | client | defaults to `http://localhost:3000`                      |
| `SUPABASE_SECRET_KEY`                   | server | admin/service modules only — bypasses RLS                |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | server | Twitch app credentials for IGDB                          |
| `PINECONE_API_KEY`                      | server | required                                                 |
| `PINECONE_INDEX_NAME`                   | server | defaults to `savepoint-games`                            |
| `ADMIN_USER_IDS`                        | server | optional, comma-separated user IDs                       |
| `CRON_SECRET`                           | server | optional, guards the cron refresh endpoint (added later) |

The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
variables are intentionally **not** used.

> `NEXT_PUBLIC_*` values are inlined at **build time** — rebuild the Docker image
> when they change.

## Scripts

| Script                              | Purpose                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                       | Start the dev server (webpack)                                                                                   |
| `npm run build`                     | Production build, standalone output (webpack), then copies `public/`/`.next/static/` into `.next/standalone/`    |
| `npm run dev:turbo` / `build:turbo` | Same, using Turbopack (see constraint below)                                                                     |
| `npm run start`                     | Run the standalone production server (`node .next/standalone/server.js`) — requires a prior `npm run build`      |
| `npm run verify-standalone`         | Opt-in smoke check: boots the standalone server and confirms `/`, a static asset, and `/favicon.ico` all respond |
| `npm run lint`                      | ESLint                                                                                                           |
| `npm run typecheck`                 | `tsc --noEmit`                                                                                                   |
| `npm run test`                      | Vitest (unit/component)                                                                                          |
| `npm run format`                    | Prettier write                                                                                                   |
| `npm run check-env`                 | Report SET/MISSING for the env contract                                                                          |

## Database migrations

SQL migrations under `supabase/migrations/` are the **source of truth**. This
repo is **not** linked to the remote Supabase project.

Until CLI push is explicitly approved, apply each generated migration
**manually via the Supabase SQL Editor**, in filename order. (Schema DDL is
authored in the next milestone.)

## Known constraint: Turbopack + network share

The Windows project folder `Z:\Savepoint` is a mapped **UNC network share** to
the ZimaOS host (`\\...\ZimaOS-HD\Savepoint`, i.e. `/DATA/Savepoint`). Next 16's
default bundler, **Turbopack**, cannot resolve the extended `\\?\UNC\...` path
form and fails PostCSS/CSS processing on it. The dev/build scripts therefore
default to **webpack** (`--webpack`), which works on the share. Turbopack is
fine on a normal local path (e.g. inside the Docker build), available via the
`:turbo` scripts.

## Deployment

Production uses Next.js `output: "standalone"`. The production entrypoint is the
generated standalone server (NOT `next start`) — `npm run start` runs this
directly:

```bash
node .next/standalone/server.js
```

Next's standalone trace does not include `public/` or `.next/static/` — both
`npm run build` and `npm run build:turbo` run `scripts/prepare-standalone.mts`
immediately afterward to copy them into `.next/standalone/`. Run
`npm run verify-standalone` after a build to confirm the standalone server
actually serves pages and static assets (it does not exercise any
authenticated flow).

This runs inside a Docker image on ZimaOS. The `Dockerfile` and ZimaOS deploy
steps are added in the hardening milestone. Server secrets are injected as
container environment variables and are never baked into the image or logged.

## Tech stack

Next.js 16 (App Router, RSC-first) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 · shadcn/ui (neutral) · Lucide · Supabase (`@supabase/ssr`) ·
Pinecone (integrated embeddings) · Zod · Vitest + Testing Library.
