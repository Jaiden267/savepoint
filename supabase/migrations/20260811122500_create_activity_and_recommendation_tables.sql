-- activity_events: the feed source. Rows are written EXCLUSIVELY by
-- SECURITY DEFINER trigger functions attached to the real source tables
-- (see activity_events_triggers migration) — there is no INSERT policy or
-- GRANT for anon/authenticated (see rls_activity_recommendation_policies
-- migration). This is the entire anti-forgery mechanism: a client cannot
-- insert a row here directly under any circumstances, only as an atomic side
-- effect of a real mutation on reviews/user_games/diary_entries/lists/follows.
create table public.activity_events (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users (id) on delete cascade,
  event_type  text not null check (
    event_type in (
      'review_published', 'game_rated', 'game_completed',
      'diary_entry_logged', 'list_created', 'follow_created'
    )
  ),
  object_type text not null check (
    object_type in ('review', 'user_game', 'diary_entry', 'list', 'follow')
  ),
  object_id   uuid not null,
  game_id     uuid references public.games (id) on delete set null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.activity_events is
  'Feed source. Rows are written exclusively by SECURITY DEFINER trigger '
  'functions on the source tables — there is intentionally no INSERT policy '
  'or GRANT for anon/authenticated. NEVER add FORCE ROW LEVEL SECURITY to '
  'this table: that would break the table-owner RLS bypass the trigger-only '
  'design depends on, and there would be no remaining insert path at all. '
  'Hard invariant for any future trigger added here: never log an event '
  'about content that is not itself publicly visible (e.g. a private list) — '
  'this table''s SELECT policy is public, so that''s what keeps it safe.';

comment on column public.activity_events.object_id is
  'Polymorphic reference into reviews/user_games/diary_entries/lists/follows '
  'depending on object_type — intentionally has no FK (a single column '
  'cannot target 5 different tables). Integrity is the responsibility of the '
  'trigger functions that are this table''s only write path. Deleting a '
  'source row does not cascade-delete its activity_events row (a known, '
  'accepted limitation for this milestone — feed queries should tolerate a '
  'dangling object_id; a Prompt 5+ follow-up may add companion cleanup).';

create index activity_events_created_idx on public.activity_events (created_at desc);
create index activity_events_actor_created_idx on public.activity_events (actor_id, created_at desc);
create index activity_events_game_id_idx on public.activity_events (game_id) where game_id is not null;

alter table public.activity_events enable row level security;

-- recommendation_feedback: discrete, append-only interaction events (not a
-- mutable state row) — no UPDATE is exposed, matching event_types being a
-- log of what happened rather than a current-status field.
create table public.recommendation_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete cascade,
  event_type text not null check (
    event_type in ('shown', 'clicked', 'saved', 'dismissed', 'completed')
  ),
  created_at timestamptz not null default now()
);

comment on column public.recommendation_feedback.game_id is
  'ON DELETE CASCADE (unlike user_games/reviews/list_items): this is a '
  'telemetry log about a recommendation, not the user''s own curated '
  'content, so there is nothing worth preserving once the game is gone.';

create index recommendation_feedback_user_created_idx
  on public.recommendation_feedback (user_id, created_at desc);
create index recommendation_feedback_game_id_idx on public.recommendation_feedback (game_id);

alter table public.recommendation_feedback enable row level security;

-- game_vector_sync: tracks Pinecone sync state only — no vector data is ever
-- stored here. Strict 1:1 satellite of games; server-only (no RLS
-- policy/GRANT at all for anon/authenticated — see the RLS policies
-- migration).
create table public.game_vector_sync (
  game_id           uuid primary key references public.games (id) on delete cascade,
  status            text not null default 'pending' check (
    status in ('pending', 'synced', 'failed')
  ),
  last_attempted_at timestamptz,
  last_synced_at    timestamptz,
  attempt_count     integer not null default 0,
  error             text,
  updated_at        timestamptz not null default now()
);

comment on table public.game_vector_sync is
  'Pinecone sync ledger — status/timestamps/error only, never vector data. '
  'Server-only: no RLS policy or GRANT of any kind for anon/authenticated.';

create index game_vector_sync_pending_idx
  on public.game_vector_sync (status)
  where status in ('pending', 'failed');

alter table public.game_vector_sync enable row level security;
