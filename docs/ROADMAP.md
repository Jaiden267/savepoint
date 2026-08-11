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
- [ ] **Prompt 5 — Graph & feed**: follows, `activity_events` feed, profile
      pages + stats.
- [ ] **Prompt 6 — Lists**: ranked/unranked lists + items.
- [ ] **Prompt 7 — Pinecone**: index bootstrap (`llama-text-embed-v2`,
      namespace `games`), on-demand upsert via `game_vector_sync`, semantic
      search, recommendations + reasons, `recommendation_feedback`. Replaces
      the placeholder in `src/lib/pinecone/`.
- [ ] **Prompt 8 — Hardening/deploy**: Playwright e2e, accessibility/contrast
      pass, Dockerfile, ZimaOS deployment, cron refresh endpoint.
