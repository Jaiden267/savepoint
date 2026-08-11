-- RLS policies + GRANTs for activity_events, recommendation_feedback,
-- game_vector_sync.

-- activity_events: publicly readable feed. Deliberately NO insert/update/
-- delete policy or GRANT for anon/authenticated at all — writes happen
-- exclusively through the SECURITY DEFINER trigger functions created in the
-- activity_events_triggers migration, which bypass RLS as the function
-- owner. See the full rationale on the table itself and on those functions.
create policy "activity_events are publicly readable"
on public.activity_events for select to anon, authenticated using (true);

grant select on public.activity_events to anon, authenticated;

-- recommendation_feedback: visible and writable only by its own user. No
-- UPDATE policy or grant — these are discrete, append-only interaction
-- events, not a mutable state row.
create policy "users can read their own recommendation feedback"
on public.recommendation_feedback for select to authenticated
using (user_id = (select auth.uid()));

create policy "users can insert their own recommendation feedback"
on public.recommendation_feedback for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users can delete their own recommendation feedback"
on public.recommendation_feedback for delete to authenticated
using (user_id = (select auth.uid()));

grant select on public.recommendation_feedback to authenticated;
grant insert (game_id, event_type) on public.recommendation_feedback to authenticated;
grant delete on public.recommendation_feedback to authenticated;

-- game_vector_sync: server-only. No RLS policy and no GRANT of any kind for
-- anon/authenticated — the only access path is the service role
-- (src/lib/supabase/admin.ts), which bypasses RLS/GRANTs entirely by design.
-- This table should never gain a client-facing policy; if a future prompt
-- needs the client to see sync status, expose it through a narrow view or
-- server-side API route instead of relaxing this table directly.
