# Roadmap

Milestones map 1:1 to the numbered prompts in this project. Sequencing is
fixed — do not renumber later stages when adding work to an earlier one.

- [x] **Prompt 0 (plan)** — architecture decisions, approved.
- [x] **Prompt 0 (foundation implementation)** — this codebase: tooling, env
      modules, Supabase clients, shadcn/ui neutral theme, app shell, health
      route, docs, placeholders for IGDB/Pinecone. See
      [PROJECT_STATE.md](./PROJECT_STATE.md) for exact status.
- [ ] **Prompt 1 — Database schema + RLS**: the 17 tables (see
      [ARCHITECTURE.md](./ARCHITECTURE.md#data-model-outline---full-ddl-lands-in-the-database-milestone)),
      policies, indexes, functions/triggers as committed migrations;
      generated types. Applied manually via the Supabase SQL Editor.
- [ ] **Prompt 2 — Auth**: signup/login/callback flows, `profiles` bootstrap
      trigger, proxy route guards, account/profile settings.
- [ ] **Prompt 3 — IGDB integration**: Twitch token cache, `game-sync`
      service, cache-first game pages, keyword search. Replaces the
      placeholder in `src/lib/igdb/`.
- [x] **Prompt 4 — Core social**: `user_games` ratings (1-10 stored, 0.5-5★
      shown) + statuses, diary, spoiler-aware reviews, likes/comments. See
      [SOCIAL.md](./SOCIAL.md) — automated checks pass and the full manual
      two-user browser checklist has been run to completion, every item
      passed. Complete.
- [x] **Prompt 5 — Lists, social & profiles**: this project's actual Prompt 5
      task combined the originally-separate "Graph & feed" and "Lists"
      milestones into one — ranked/unranked lists with visibility
      enforcement, follows, the `activity_events` feed, complete profile
      pages + stats, and discovery (user search, popular public lists,
      recent public reviews). Migration 19 (`user_rating_distribution`,
      `list_public_summary`, `reorder_list_items`) is applied and confirmed
      live; all application code passed every automated check
      (lint/typecheck/**371/371** tests/format/build); the user has
      personally run the full live two-user/one-private-list manual
      checklist — every item passed, no regressions found. See
      [SOCIAL.md](./SOCIAL.md#manual-two-user--one-private-list-checklist)
      and [PROJECT_STATE.md](./PROJECT_STATE.md). Complete.
- [ ] **Prompt 6 — Lists**: merged into Prompt 5 above — there is no
      separate Lists-only milestone in this project's actual prompt
      sequence. Left as a placeholder line rather than deleted, so this
      document's history stays honest about the renumbering-avoidance rule
      above; Prompts 7 and 8 keep their original numbers.
- [ ] **Prompt 7 — Pinecone**: index bootstrap (`llama-text-embed-v2`,
      namespace `games`), on-demand upsert via `game_vector_sync`, semantic
      search, recommendations + reasons, `recommendation_feedback`. Replaces
      the placeholder in `src/lib/pinecone/`. **Semantic search half is
      complete and live-verified**: the `savepoint-games` index is
      bootstrapped (integrated embedding, `llama-text-embed-v2`, namespace
      `games`, deletion protection enabled), the concurrency-safe
      on-demand + backfillable sync pipeline is live, a bounded 5-game
      backfill and the three-query smoke test both ran successfully against
      the real index with every hit resolving to a genuine Supabase `games`
      row, and `/search` has a working semantic mode with lexical fallback.
      See [PINECONE.md](./PINECONE.md) and
      [PROJECT_STATE.md](./PROJECT_STATE.md). **Recommendations and
      reasons, and `recommendation_feedback`, are not started** — left for
      a later pass, hence this line stays unchecked.
- [ ] **Prompt 7C — broad IGDB catalogue semantic indexing**: expands
      Prompt 7's semantic search from cached-only to a curated ~25–29K-game
      IGDB catalogue slice, without bulk-populating Supabase. **Gate A1/A2
      (infrastructure) is complete**: the migration is applied and
      live-verified (three new tables, an atomic checkpoint RPC with real
      compare-and-set fencing, a global lease, per-minute Pinecone pacing),
      the Pinecone record schema moved to v2 (`igdb-${igdbId}` ids,
      `schema_version`-aware re-sync), the semantic-search hydration path
      was fixed to key on `igdb_id` (never a Supabase UUID), catalogue-only
      results render with a POST-based import boundary, and both operator
      scripts (`igdb-catalogue-estimate`, `igdb-catalogue-sync`) are built
      and dry-run-verified. See [PINECONE.md](./PINECONE.md#broad-catalogue-indexing-prompt-7c)
      and [PROJECT_STATE.md](./PROJECT_STATE.md). **No live IGDB catalogue
      discovery or Pinecone catalogue upsert has run** — Gates B (profile
      selection) through E (full background sync) each remain behind a
      separate, explicit future approval, hence this line stays unchecked.
- [ ] **Prompt 8 — Hardening/deploy**: Playwright e2e, accessibility/contrast
      pass, Dockerfile, ZimaOS deployment, cron refresh endpoint. **The
      design/responsive/accessibility portion is complete and fully
      manually verified**: design tokens, a mobile nav (bottom tab bar +
      drawer), a route-by-route consistency sweep, and a batch of real
      accessibility fixes (spoiler-reveal semantics, missing field labels,
      an icon-button accessible-name gap, touch-target sizing, a targeted
      `prefers-reduced-motion` rule) — automated checks clean and the
      user's full manual browser checklist (360/768/1024/1440px,
      signed-in/out, keyboard, reduced motion) passed every item — see
      [DESIGN.md](./DESIGN.md) and [PROJECT_STATE.md](./PROJECT_STATE.md).
      Playwright e2e, the Dockerfile, ZimaOS deployment, and the cron
      refresh endpoint remain separately deferred and unstarted, hence this
      line stays unchecked.
