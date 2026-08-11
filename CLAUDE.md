# Savepoint — project rules

Letterboxd-style social platform for video games. Full architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Current status:
[docs/PROJECT_STATE.md](docs/PROJECT_STATE.md). Milestones:
[docs/ROADMAP.md](docs/ROADMAP.md). Env variable contract:
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

@AGENTS.md

## Security boundaries — do not cross these

- **Row Level Security is the authorization model.** Normal user CRUD always
  runs through the user's authenticated Supabase session
  (`src/lib/supabase/client.ts` / `server.ts`), never the secret key.
- **`SUPABASE_SECRET_KEY` is admin-only.** It's isolated in
  `src/lib/supabase/admin.ts` and bypasses RLS. Use it only in explicit
  server-only administrative modules — never to serve a normal user request.
- **Never use the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` or
  `SUPABASE_SERVICE_ROLE_KEY`** variable names. This project uses
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
- **Secrets never reach the client.** `src/lib/env.server.ts`,
  `src/lib/supabase/admin.ts`, `src/lib/igdb/*`, and `src/lib/pinecone/*` all
  start with `import "server-only"`. Never import them from a Client
  Component (`"use client"`).
- **Never print, log, or commit an environment variable's value.** Report
  SET/MISSING only (see `npm run check-env`).
- **No arbitrary IGDB/Pinecone passthrough endpoints.** API routes are
  purpose-built and validate input with Zod; they don't expose raw
  query execution.
- **No `dangerouslySetInnerHTML` for review or user-generated content.**
- **No fake data or permanent mocks to hide an error.** The IGDB and Pinecone
  client modules are intentionally unimplemented placeholders right now — they
  throw a clear error if called rather than returning fabricated data.
- Do not call or mutate Supabase, IGDB, or Pinecone as a side effect of
  routine dev/build/lint/test work in this repo.
- Do not `git commit` or `git push` unless explicitly asked.

## Key paths

| Path                                          | What's there                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/app/`                                    | Routes — RSC by default, `"use client"` only for leaf interactive components            |
| `src/proxy.ts`                                | Session-refresh interceptor (this Next.js version renamed `middleware.ts` → `proxy.ts`) |
| `src/lib/env.ts` / `env.server.ts`            | Zod-validated env, client-safe vs. server-only                                          |
| `src/lib/supabase/`                           | `client.ts`, `server.ts`, `session.ts` (user session + RLS), `admin.ts` (secret key)    |
| `src/lib/igdb/`, `src/lib/pinecone/`          | Server-only integration placeholders — not implemented yet                              |
| `src/lib/rating.ts`                           | Single source of the 1–10 (DB) ↔ 0.5–5.0★ (UI) conversion                               |
| `src/components/ui/`                          | shadcn primitives                                                                       |
| `src/components/common/`, `layout/`, `games/` | Shared foundations (empty/error state, typography, app shell, poster skeleton)          |
| `supabase/migrations/`                        | Committed SQL migrations — source of truth, **not** linked to any remote project        |
| `docs/`                                       | Architecture, roadmap, project state, environment contract                              |

## Commands

```bash
npm run dev           # dev server (webpack — see docs/PROJECT_STATE.md for why)
npm run build          # production build, standalone output
npm run start           # next start (local only — see note below)
npm run lint              # ESLint
npm run typecheck          # tsc --noEmit
npm run test                 # Vitest
npm run test:watch            # Vitest watch mode
npm run format                  # Prettier write
npm run format:check              # Prettier check
npm run check-env                   # SET/MISSING report, no values
```

Production entrypoint is `node .next/standalone/server.js`, not `next start`
(this project uses `output: "standalone"`).

## Working here

- Node 24 (see `.nvmrc`), npm + `package-lock.json`.
- TypeScript strict mode, `@/*` → `src/*`.
- RSC by default; reach for a Client Component only when interaction or a
  browser API requires it.
- This project folder is a UNC network share — see
  [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md#known-environment-quirks) before
  fighting Turbopack or git ownership errors.
