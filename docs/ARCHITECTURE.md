# Architecture

Savepoint is a Letterboxd-style social platform for video games. This document
is the living architecture reference; the original approval record is the
Prompt 0 plan. It's updated as later milestones land — see
[ROADMAP.md](./ROADMAP.md) for sequencing and [PROJECT_STATE.md](./PROJECT_STATE.md)
for what's actually built right now.

## Stack

Next.js (App Router, RSC-first) · React · TypeScript (strict) · Tailwind CSS ·
shadcn/ui (neutral theme, Base UI primitives) · Lucide icons · Supabase
(`@supabase/supabase-js` + `@supabase/ssr`) · Pinecone (integrated embeddings) ·
Zod · Vitest + Testing Library (Playwright added before final acceptance) ·
Docker standalone output for ZimaOS.

## Folder structure

```
src/
  app/            routes — RSC by default, API route handlers, proxy-guarded shell
  components/
    ui/           shadcn primitives (button, card, input, skeleton, ...)
    common/       shared foundations (empty-state, error-state, typography)
    layout/       app shell (site header/footer)
    games/        game-domain UI (e.g. poster-card-skeleton)
  lib/
    env.ts        client-safe env (Zod)
    env.server.ts server-only env (Zod, `server-only` guarded)
    supabase/     client.ts, server.ts, session.ts (user session + RLS), admin.ts (secret key, RLS-bypassing)
    igdb/         IGDB integration (built, Prompt 3 — see docs/IGDB.md)
    pinecone/     Pinecone integration (built, Prompts 7/7C — see docs/PINECONE.md)
    rating.ts     single source of the 1-10 <-> 0.5-5★ conversion
  proxy.ts        session-refresh interceptor (Next's renamed "middleware")
supabase/
  config.toml     local Supabase CLI config
  migrations/     committed SQL migrations — source of truth (see below)
docs/             this file, ROADMAP, PROJECT_STATE, ENVIRONMENT
```

## Route map

**Public / marketing**: `/` (landing).

**Game discovery** (built in Prompt 3, public — no login required):
`/discover` (paginated local catalogue browse), `/search` (keyword search,
local-first with IGDB fallback), `/games/[slug]` (game detail — imports the
game into the local cache on first open, see docs/IGDB.md), plus a ⌘K search
command dialog in the global nav. `GET /api/search` is the only
IGDB-touching endpoint reachable from the browser.

**Auth** (`(auth)` route group — built in Prompt 2, see docs/AUTH.md):
`/login` · `/signup` · `/forgot-password` · `/reset-password` ·
`/auth/callback` (PKCE code-exchange route handler, not a page).
Already-authenticated visitors are redirected away from `/login`/`/signup`/
`/forgot-password`; unauthenticated visitors are redirected away from
`/reset-password` — enforced in `src/proxy.ts` via
`src/lib/auth/route-policy.ts`.

**Profile** (built in Prompt 2): `/onboarding` (authenticated, required once
per account before `/settings/profile` is reachable — gated by
`profiles.onboarding_completed_at`) · `/settings/profile` (authenticated,
requires completed onboarding) · `/users/[username]` (public — note this is
`/users/…`, not the earlier-sketched `/u/…`).

**Core tracking** (built in Prompt 4, see docs/SOCIAL.md): `/games/[slug]`
gains an action panel (status/rating/log-play/review) plus aggregate rating
and recent reviews on top of Prompt 3's read-only page. `/library`
(authenticated, requires completed onboarding — current user's own library,
status tabs + sort + pagination) · `/diary` (authenticated, requires
completed onboarding — current user's own diary, paginated) ·
`/reviews/[id]` (public — a single review permalink with like/unlike and a
comment thread).

**App shell** (authenticated, added in later milestones): `/home` (feed),
`/recommendations`, `/lists`, `/lists/[id]`, further `/users/[username]`
tabs (`/diary`, `/ratings`, `/reviews`, `/lists`, `/stats`, `/following`,
`/followers`), `/settings/account`, `/admin` (gated by `ADMIN_USER_IDS`).

**API route handlers** (server-only, purpose-built — never a generic passthrough
to IGDB/Pinecone): `GET /api/profile/username-availability` (Prompt 2, rate
limited), `GET /api/search` (Prompt 3, rate limited — the only IGDB-touching
endpoint reachable from the browser), `GET /api/recommendations`,
`POST /api/cron/refresh` (guarded by `CRON_SECRET`, added later).
`GET /api/health` exists today.

Mutations prefer Server Actions over ad-hoc API routes; API routes are for
cron, search, and external-service orchestration.

## Server/client boundaries

- RSC by default. Client Components only where interaction or browser APIs
  require them, kept as small leaf components.
- Secrets never cross to the client. `src/lib/igdb`, `src/lib/pinecone`, and
  `src/lib/supabase/admin.ts` start with `import "server-only"`.
- `src/lib/env.ts` is safe from either side; `src/lib/env.server.ts` is
  `server-only` guarded and must never be imported from a Client Component.
- Session refresh runs in `src/proxy.ts` (Next's App-Router request
  interceptor — this Next.js version renamed `middleware.ts` to `proxy.ts`).

## Data model

21 tables as of Prompt 3 (17 from Prompt 1 + `game_modes`, `themes`,
`game_game_modes`, `game_themes` added by migration 18 — see
[docs/DATABASE.md](./DATABASE.md)): `profiles, games, genres, platforms,
game_genres, game_platforms, game_modes, themes, game_game_modes,
game_themes, user_games, diary_entries, reviews, review_likes,
review_comments, lists, list_items, follows, activity_events,
recommendation_feedback, game_vector_sync`. Row Level Security is enabled on
every table.

`user_games` is the core per-user/per-game row: `rating smallint 1-10`
(displayed as 0.5-5.0 stars via `src/lib/rating.ts`) and `status`
(wishlist/backlog/playing/completed/paused/dropped) both live there. As of
Prompt 4, its `rating` is also the sole input to the `game_rating_stats`
aggregate view (average + count, consumed by `/games/[slug]`'s Rating
section); `review_like_counts` similarly backs every review's like count.
`diary_entries.rating`/`reviews.rating` are independent point-in-time
snapshots, never written back to `user_games.rating` — see
[docs/SOCIAL.md](./SOCIAL.md) for the full invariant.

`games` is a Supabase cache of IGDB data — all user tables FK to it rather than
storing raw IGDB IDs directly, so ratings/reviews/lists have a stable,
queryable target and IGDB calls stay bounded.

Migrations are committed SQL under `supabase/migrations/` — the source of
truth. The repo is now CLI-linked to the remote Supabase project;
migrations are applied manually by the project owner (`supabase db push`
or equivalent) — never automatically, and never by a migration file's
mere presence in the repo.

## Authentication

`@supabase/ssr` with the **publishable key** for both the browser and
user-scoped SSR — all normal user CRUD runs under the user's session and RLS.
`src/lib/supabase/admin.ts` (secret key, bypasses RLS) is isolated for
explicit administrative modules only.

Built in Prompt 2 — full detail in [docs/AUTH.md](./AUTH.md):
`src/proxy.ts` refreshes the session cookie on every matched request via
`getUser()` (never trusts the raw cookie), then applies route protection
through a pure, unit-tested decision function
(`src/lib/auth/route-policy.ts`) — auth-required pages, redirecting
already-authenticated visitors away from `/login`/`/signup`, and gating
`/settings/profile` behind onboarding completion
(`profiles.onboarding_completed_at`). Email/password sign-up, sign-in,
sign-out, and forgot/reset-password all run as Server Actions
(`src/server/actions/auth.ts`, `profile.ts`) using the cookie-based server
client — never the secret key. `/auth/callback` is the PKCE code-exchange
route handler shared by email confirmation and password recovery links.

## IGDB integration (built in Prompt 3 — full detail in docs/IGDB.md)

Cache-first reads from the `games` table via `src/server/services/game-catalogue.ts`
(read-only, never writes). `src/server/services/game-sync.ts` is the only
write path — a game is imported only when explicitly opened
(`/games/[slug]`), never as a side effect of a search results list
rendering, and idempotently (a second import can never create a duplicate
row). `src/lib/igdb/` provides the Twitch token cache, a 4 req/s +
8-concurrent request scheduler, and the sole Apicalypse query builder — no
arbitrary IGDB query is ever exposed to clients, and `GET /api/search` is the
only IGDB-touching endpoint reachable from the browser. Imported games are
marked `pending` in `game_vector_sync` for the future Pinecone milestone to
pick up — no Pinecone call happens yet.

## Pinecone (built, Prompts 7/7C — full detail in docs/PINECONE.md)

Integrated-embedding index `savepoint-games` (`PINECONE_INDEX_NAME`), model
**`llama-text-embed-v2`**, namespace `games`, source text mapped to field
`text`. On bootstrap: `describe-index` first — if an incompatible index
already exists, stop and report the conflict; never delete or recreate it.
Upserts are on-demand (tracked by the `game_vector_sync` table, an
idempotent lease-guarded sync per game) — semantic search
(`/search?mode=semantic`) is live. Prompt 7C (infrastructure built, no
live catalogue indexing run yet — see docs/PINECONE.md) adds a resumable,
checkpointed system (`igdb_catalogue_sync`/`igdb_catalogue_discovery_
cursor`/`igdb_catalogue_lease` tables, an atomic `advance_catalogue_
discovery` RPC) for indexing a broad, curated slice of the IGDB catalogue
— not just games Savepoint has cached — gated behind separate explicit
approvals before any real discovery or Pinecone write happens.
Recommendations and reasons, and `recommendation_feedback`, remain
explicitly deferred to a later prompt.

## Testing

Vitest + Testing Library for unit/component tests today; Playwright for
end-to-end happy paths before final acceptance. External services are mocked
at the boundary in tests — no live keys used in unit tests.

## Deployment

`next.config.ts` sets `output: "standalone"`. Production runs
`node .next/standalone/server.js` (not `next start`) inside a Docker image on
the ZimaOS mini PC. `NEXT_PUBLIC_*` values are inlined at **build** time —
rebuild the image when they change. Server secrets are injected as container
environment variables and are never baked into the image or logged.
