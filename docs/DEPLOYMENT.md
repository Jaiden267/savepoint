# Deployment — ZimaOS + existing Cloudflare Tunnel (LAN-host architecture)

Production topology for `game.savepoint.social`, running as a Docker
container on ZimaOS, published directly to the host's LAN port. The
existing Cloudflare Tunnel on this server (the same tunnel that serves
Plex and other apps) is pointed at that host:port from its own dashboard.
This runbook does not create, recreate, stop, reconfigure, inspect, or
connect networks to that tunnel or its container — the only change made
to it is adding one published-application route in the Cloudflare
dashboard.

## Topology

```
Internet
   │  https://game.savepoint.social
   ▼
Cloudflare edge
   │  (existing tunnel, unchanged)
   ▼
existing cloudflared container (already serving Plex + others, untouched)
   │  http://192.168.1.210:3000
   ▼
ZimaOS host, port 3000 (published by Docker)
   │
   ▼
savepoint container, port 3000
   │  outbound only: Supabase, IGDB, Pinecone
   ▼
Supabase / IGDB / Pinecone (external services, unchanged)
```

Key properties:

- **Savepoint is published directly to the ZimaOS host.** `compose.production.yml`
  maps `ports: ["3000:3000"]` — the app is reachable on the LAN at
  `http://192.168.1.210:3000`.
- **No Docker network is created or shared with cloudflared.** This is a
  LAN-host architecture, not a private-network architecture — cloudflared
  reaches Savepoint the same way any other LAN client would: over the
  host's own network stack, not container-to-container DNS.
- **cloudflared itself is never inspected, restarted, or reconfigured at
  the Docker level.** The tunnel's route to Savepoint is configured
  entirely from the Cloudflare Zero Trust dashboard (below) — nothing
  about cloudflared's container, networks, or other published apps
  changes.
- **No router port forwarding is configured or required.** `192.168.1.210:3000`
  is a LAN-only address; the public path is exclusively through the
  existing Cloudflare Tunnel.
- **No TLS is configured inside Savepoint.** Cloudflare terminates TLS at
  the edge; traffic from cloudflared to `192.168.1.210:3000` is plain
  HTTP on the LAN, same as the container's own listener.

## One-time setup

There is no Docker-level setup required beyond building and starting the
container (below) — no network to create, no existing container to join
or inspect.

### Cloudflare Zero Trust — add the published-application route

In the Cloudflare Zero Trust dashboard, on the **same existing tunnel**
that already routes Plex/other apps:

- Networks → Tunnels → (your existing tunnel) → Public Hostname → Add
- **Subdomain**: `game`
- **Domain**: `savepoint.social`
- **Service**: `HTTP` → `192.168.1.210:3000`

This is the only change made to the tunnel. It does not require
restarting or recreating the tunnel, and does not affect any other
published application on it — Cloudflare Zero Trust hostnames are
added/edited live.

### Supabase — allow the new origin

In the Supabase dashboard → Auth → URL Configuration:

- **Site URL**: `https://game.savepoint.social`
- **Additional Redirect URLs**: `https://game.savepoint.social/**`

Without this, sign-in/sign-up email links and the `/auth/callback` route
will be rejected by Supabase's redirect allowlist.

## Directory layout on the server

| Path                                  | Purpose                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/DATA/Savepoint`                     | Source checkout (this repo) — where `docker compose build` runs from.                                                                |
| `/DATA/AppData/savepoint/.env.server` | The single environment file for this deployment. Supplies both the `NEXT_PUBLIC_*` build-arg substitutions and every runtime secret. |

There is no separate build-time env file — `/DATA/Savepoint/.env` is not
used or required by this deployment. One file, passed explicitly via
`--env-file` on every `docker compose` invocation (below), covers both
purposes.

This file stays on the server, outside the git repo, and is never
committed (see `.gitignore`/`.dockerignore` — every `.env*` variant except
the placeholder `.env.example` is excluded from both).

## Environment variable contract (names only — see `.env.example`)

All variables below live in the one file, `/DATA/AppData/savepoint/.env.server`.

### Build-time substitutions (`NEXT_PUBLIC_*`)

Read by `docker compose --env-file ... build` for `${VAR}` substitution
into `compose.production.yml`'s `build.args`, then inlined into the
browser bundle. Changing one requires a rebuild, not just a restart.

| Variable                               | Required | Notes                                                               |
| -------------------------------------- | -------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes      | Supabase project URL.                                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes      | Supabase publishable key — safe for the browser, RLS still applies. |
| `NEXT_PUBLIC_APP_URL`                  | Yes      | Set to `https://game.savepoint.social` in production.               |
| `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL`    | No       | Leave empty until a real, monitored mailbox exists for `/privacy`.  |

### Runtime secrets

Server-only — never sent to the browser, never present in the image or
the build context (`import "server-only"` guards every module that reads
these; see `docs/ENVIRONMENT.md`). Passed to the running container via
this compose file's `env_file:` entry.

| Variable              | Required | Notes                                                    |
| --------------------- | -------- | -------------------------------------------------------- |
| `SUPABASE_SECRET_KEY` | Yes      | Bypasses RLS — used only in `src/lib/supabase/admin.ts`. |
| `IGDB_CLIENT_ID`      | Yes      | Twitch application client ID.                            |
| `IGDB_CLIENT_SECRET`  | Yes      | Twitch application client secret.                        |
| `PINECONE_API_KEY`    | Yes      | Pinecone API key.                                        |
| `PINECONE_INDEX_NAME` | No       | Defaults to `savepoint-games`.                           |
| `ADMIN_USER_IDS`      | No       | Comma-separated Supabase user IDs, empty by default.     |
| `CRON_SECRET`         | No       | Guards the scheduled refresh endpoint once it exists.    |

Full purpose/detail for each variable: [ENVIRONMENT.md](./ENVIRONMENT.md).
**Never** put a real value in this doc, in `.env.example`, in a commit, or
in a log line — names only, everywhere outside
`/DATA/AppData/savepoint/.env.server`.

## Build and deploy

From `/DATA/Savepoint` on the server:

```bash
# Build the image. --env-file supplies the NEXT_PUBLIC_* build-arg
# substitutions from the one runtime env file.
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml build

# Start (or restart) the container.
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml up -d
```

`restart: unless-stopped` means the container survives a ZimaOS/Docker
daemon restart without manual intervention.

## Health check

`src/app/api/health/route.ts` is an unauthenticated `GET /api/health`
returning `{status: "ok", service: "savepoint", timestamp}`. The image's
`HEALTHCHECK` (in the `Dockerfile`, and mirrored in
`compose.production.yml`) polls this every 30s using Node's built-in
`fetch` — no `curl`/`wget` added to the runtime image. Check container
health with:

```bash
docker inspect --format='{{.State.Health.Status}}' savepoint
```

Once running, the app should also respond directly on the LAN at
`http://192.168.1.210:3000` — useful for testing before or independently
of the Cloudflare Tunnel route.

## Rotating a secret (e.g. after an API key reset)

Runtime secrets (`IGDB_CLIENT_SECRET`, etc.) don't require a rebuild —
edit `/DATA/AppData/savepoint/.env.server` on the server, then:

```bash
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml up -d --force-recreate savepoint
```

Rotating a `NEXT_PUBLIC_*` value **does** require a rebuild, since it's
baked into the bundle: edit the same file, then re-run the `build`
command above followed by `up -d`.

## Updating the app

```bash
cd /DATA/Savepoint
git pull
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml build
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml up -d
```

## Stopping / rolling back

```bash
# Stop the container without removing it.
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml stop

# Roll back to a previous commit/image, then rebuild and restart.
git checkout <previous-commit>
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml build
docker compose --env-file /DATA/AppData/savepoint/.env.server -f compose.production.yml up -d
```

## Local verification (no deployment)

Before deploying, the full automated verification suite
(`lint`/`typecheck`/`test`/`format:check`/`build`/`verify-standalone`) can
be run from a normal checkout, plus `docker compose -f compose.production.yml config`
(with placeholder environment values) to confirm the compose file itself
is well-formed — none of this touches the production topology above.
