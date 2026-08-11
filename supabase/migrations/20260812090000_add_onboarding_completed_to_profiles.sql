-- Additive migration (Prompt 2 — auth/onboarding). Does not modify any
-- already-applied migration file.
--
-- profiles rows are always auto-created by handle_new_user() with a
-- provisional, email-derived username — so a profile always technically
-- "exists," but the user hasn't yet confirmed/customized it. This column is
-- the explicit signal for "has the user been through onboarding":
-- null = not yet completed; set once, at completion, to the timestamp.
alter table public.profiles
  add column onboarding_completed_at timestamptz;

comment on column public.profiles.onboarding_completed_at is
  'Null until the user completes the onboarding flow (confirms/customizes '
  'their auto-generated username, optionally sets display_name/bio). Used '
  'by the proxy route policy to redirect incomplete profiles to /onboarding.';

-- Same column-level GRANT pattern established in migration 16: additive,
-- narrow, only this one column, only to authenticated. The existing RLS
-- UPDATE policy (`id = auth.uid()`) already covers it — no policy change
-- needed, only the grant.
grant update (onboarding_completed_at) on public.profiles to authenticated;
