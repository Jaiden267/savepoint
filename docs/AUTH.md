# Authentication

Prompt 2: Supabase Auth (email/password), session handling, route
protection, onboarding, and profile management. Read this alongside
[DATABASE.md](./DATABASE.md) (the `profiles` table and its RLS) and
[ARCHITECTURE.md](./ARCHITECTURE.md) (where auth fits in the overall app).

## Architecture

**Three Supabase clients, three purposes** (`src/lib/supabase/`):

- `client.ts` — browser client (publishable key). Not used directly by any
  auth flow in this prompt — every mutation runs server-side as a Server
  Action instead, so the browser never talks to Supabase Auth directly.
- `server.ts` — cookie-based client (publishable key) for Server Components,
  Route Handlers, and Server Actions. **This is the client for every auth
  operation and every normal profile CRUD** — sign up, sign in, sign out,
  password reset, profile reads/writes, avatar storage. All of it runs under
  the user's own session and RLS.
- `admin.ts` — service-role client (`SUPABASE_SECRET_KEY`). **Not used
  anywhere in this prompt.** Auth and profile management never need to
  bypass RLS; nothing here calls `createAdminClient()`.

**Session refresh + route protection** (`src/proxy.ts` →
`src/lib/supabase/session.ts` → `src/lib/auth/route-policy.ts`):

1. `src/proxy.ts` is Next.js's current App Router request interceptor (this
   Next.js version renamed `middleware.ts` to `proxy.ts` — see
   ARCHITECTURE.md). It runs on every matched request.
2. `updateSession()` creates a request-scoped Supabase client and calls
   `supabase.auth.getUser()` — **never** `getSession()` or a raw cookie
   read. `getUser()` revalidates the token against Supabase Auth itself, so
   every route decision is based on a verified user, never an unverified
   cookie value.
3. For a small, explicit set of "gated" paths (`/login`, `/signup`,
   `/forgot-password`, `/onboarding`, `/settings/profile`,
   `/reset-password`) and only when a user is present, it does one extra
   lookup: `profiles.username, profiles.onboarding_completed_at`. Every
   other request — the large majority — never touches the database at all.
4. The gathered state (`pathname`, `isAuthenticated`, `onboardingCompleted`,
   `username`) is handed to `resolveRoutePolicy()`
   (`src/lib/auth/route-policy.ts`), a **pure function** with no Next.js or
   Supabase dependency, fully unit tested in `route-policy.test.ts`. It
   returns either `{ action: "allow" }` or
   `{ action: "redirect", destination, query? }`. `session.ts` just acts on
   that result.

**Route policy** (exact rules, see `src/lib/auth/route-policy.ts`):

| Path                                          | Unauthenticated                   | Authenticated, onboarding incomplete | Authenticated, onboarding complete |
| --------------------------------------------- | --------------------------------- | ------------------------------------ | ---------------------------------- |
| `/login`, `/signup`, `/forgot-password`       | allow                             | → own profile                        | → own profile                      |
| `/reset-password`                             | → `/forgot-password`              | allow                                | allow                              |
| `/onboarding`                                 | → `/login?next=/onboarding`       | allow                                | → own profile                      |
| `/settings/profile`                           | → `/login?next=/settings/profile` | → `/onboarding`                      | allow                              |
| everything else (`/`, `/users/[username]`, …) | allow                             | allow                                | allow                              |

**Open-redirect protection** (`src/lib/auth/redirect-safety.ts`): every
`next`/`redirect` query param consumed anywhere (login page, sign-in action,
the callback route) is validated as a root-relative, same-origin path before
use — an absolute URL, `//host` protocol-relative form, or embedded scheme
is rejected in favor of a safe fallback.

## Routes and flows

| Route               | Purpose                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`            | Email/password sign-in. Redirects already-authenticated visitors away. Shows a friendly banner for `?error=link_invalid` (an expired/used confirmation or recovery link).                                                                                                                                               |
| `/signup`           | Email/password registration. On success, shows an inline "check your inbox" message — no session yet, since email confirmation is required.                                                                                                                                                                             |
| `/forgot-password`  | Requests a password-reset email. Always shows the same generic success message, regardless of whether the email exists.                                                                                                                                                                                                 |
| `/reset-password`   | Sets a new password. Only reachable with an active recovery session (arrived via the emailed link → `/auth/callback` → here); an unauthenticated visitor is redirected to `/forgot-password` instead.                                                                                                                   |
| `/auth/callback`    | Route Handler, not a page. PKCE code-exchange endpoint shared by signup confirmation and password recovery links. Redirects to the link's own `next` param if present and safe, otherwise decides based on profile completeness. Redirects to `/login?error=link_invalid` if the code is missing or the exchange fails. |
| `/onboarding`       | Required once per account. Confirm/customize the auto-generated username (see below), optionally set a display name and bio. Redirects to the new profile page on completion.                                                                                                                                           |
| `/settings/profile` | Edit username/display name/bio (same form as onboarding, reused as `src/components/profile/profile-form.tsx`) plus avatar upload/replace/remove.                                                                                                                                                                        |
| `/users/[username]` | Public profile page — avatar, display name, bio, join date, and the `profile_stats` view (games completed / reviews / followers / following — all real numbers, will read 0 until later prompts add the underlying features). Shows an "Edit profile" link only to the profile's own owner.                             |

**Why every profile "exists" immediately but onboarding is still a real
step:** `handle_new_user()` (Prompt 1) auto-creates a `profiles` row at
signup with a provisional, email-derived username. `onboarding_completed_at`
(added this prompt, migration 17) is the actual signal for "has this user
confirmed/customized it" — null until the onboarding form is submitted.

## Security

- **Every form is validated with a shared Zod schema**
  (`src/lib/validation/auth.ts`), and every constraint mirrors its database
  CHECK constraint exactly (username regex, display name/bio max lengths,
  avatar mime types/size vs. the `avatars` bucket's own limits). Validated
  again server-side in every Server Action — client-side validation is UX
  only, never the authority.
- **Usernames** are normalized once, centrally: trimmed, checked against
  `^[a-zA-Z0-9_]{3,30}$`. Case-insensitive uniqueness comes from the
  database's `citext` column type, not application code — a plain `.eq()`
  is already case-insensitive.
- **Rate limiting** (`src/lib/rate-limit.ts`, in-memory, explicitly scoped
  to a single-instance deployment): sign-up 5/15min per IP, sign-in
  10/15min per IP, forgot-password 5/15min per IP, username-availability
  check 30/min per IP, avatar upload 10/10min per user.
- **Password recovery never discloses whether an email exists.**
  `forgotPasswordAction` always returns the identical success message
  regardless of whether Supabase actually found an account — the only
  distinct response is a rate-limit message (which reveals nothing about
  any specific email, since limiting is per-IP).
- **Protected profile fields cannot be changed by a client.** `id`,
  `created_at`, `updated_at`, and `onboarding_completed_at`'s _initial_ set
  are never part of any client-facing update — enforced at two independent
  layers: the Server Action only ever `.update()`s the specific columns a
  given flow is meant to touch, and the database's column-level `GRANT`s
  (migrations 12 and 17) don't permit `authenticated` to write anything
  else on `profiles` regardless.
- **No raw Supabase errors ever reach the UI.** `friendlyAuthError()` /
  `friendlyProfileError()` (in the two `src/server/actions/*.ts` files) map
  known error substrings to calm, specific copy; anything unrecognized
  becomes a generic "something went wrong, please try again."
- **Nothing logs passwords, tokens, or cookies.** No auth code path
  `console.log`s a Supabase error object, a session, or form input —
  Server Actions only ever return the sanitized `message`/`fieldErrors`
  already covered above.
- **`SUPABASE_SECRET_KEY` is never used for auth or profile CRUD** — see
  Architecture above. Every mutation runs through the user's own session
  and is subject to RLS.
- **Server Actions re-check auth themselves**
  (`src/lib/auth/require-user.ts`), rather than trusting that a page the
  proxy already gates is the only way they're ever invoked.

## Dashboard configuration required

Supabase Auth → **URL Configuration**, in the project's dashboard:

| Setting                       | Value                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Site URL** (local dev)      | `http://localhost:3000`                                                                                                                                                                                                                                                                                                                           |
| **Redirect URLs** (local dev) | `http://localhost:3000/auth/callback` — add as an exact entry. Recommended additional entry: `http://localhost:3000/**` (wildcard) as a safety net for any query-string variations.                                                                                                                                                               |
| **Production** (confirmed)    | Dedicated authentication domain: `savepointauth.uk`. Site URL `https://savepointauth.uk`, Redirect URL `https://savepointauth.uk/auth/callback` (+ the same `/**` wildcard recommendation). `NEXT_PUBLIC_APP_URL` must match for that build — every `emailRedirectTo`/`redirectTo` in this codebase is built from that variable, never hardcoded. |

Two more dashboard settings this prompt's design assumes but does not (and
cannot) change remotely — verify they match:

- **Confirm email** (Authentication → Providers → Email) should be **ON**.
  The signup flow's "check your inbox" messaging and the whole
  `/auth/callback` confirmation path assume email confirmation is required.
- **Minimum password length** (Authentication → Providers → Email) —
  this project's Zod schema enforces 8 characters minimum client- and
  server-side; consider setting the dashboard's own minimum to match (its
  default is 6) so the two don't disagree.
- **Custom SMTP** (Authentication → SMTP Settings) — **confirmed
  configured**, using Resend as the provider, and manually tested
  successfully (a real signup/reset email was sent and received). This is
  a dashboard-only setting; there is no application code integration and
  no `RESEND_API_KEY` (or similar) env var — Supabase calls Resend's SMTP
  endpoint directly using credentials stored in the dashboard. Needed
  because Supabase's default built-in email sending has rate limits too
  low for real usage.

## Manual integration checklist

Automated tests cover validation logic and route-protection decisions (see
Testing below) — they don't exercise a real Supabase project end to end.
Run through this by hand after applying migration 17
(`20260812090000_add_onboarding_completed_to_profiles.sql`) and confirming
the dashboard settings above:

- [ ] **Sign up** with a new email — see the "check your inbox" message,
      no session yet.
- [ ] **Confirm** via the emailed link — lands on `/onboarding`
      automatically.
- [ ] **Onboarding**: try a username under 3 characters, over 30, with a
      space or symbol — each rejected client- and server-side. Try a
      username you know is taken (e.g. sign up a second test account first)
      — see "already taken" live, and again on submit if you bypass the
      client check. Submit a valid, available username (+ optional display
      name/bio) — redirected to `/users/<username>`.
- [ ] Visit `/onboarding` again while signed in — redirected back to your
      profile (can't redo it).
- [ ] Visit `/login` or `/signup` while signed in — redirected to your
      profile.
- [ ] **Sign out** — redirected to `/`; visiting `/settings/profile`
      afterward redirects to `/login?next=/settings/profile`.
- [ ] **Sign in** with the confirmed account — lands on your profile (or
      wherever `next` pointed).
- [ ] Sign in with a **wrong password** — friendly "don't match" message,
      no raw Supabase error text.
- [ ] **Edit profile** at `/settings/profile` — change display name/bio,
      save, confirm it's reflected on `/users/<username>`.
- [ ] **Change your username** in settings to a new available one — profile
      URL now resolves at the new username.
- [ ] **Upload an avatar** (PNG/JPEG/WebP under 5MB) — appears immediately
      in settings and on the public profile.
- [ ] **Replace** the avatar with a different file type (e.g. swap a `.png`
      for a `.webp`) — old object is gone (spot-check in the Supabase
      Storage browser that only one file remains under your `uid/` folder).
- [ ] **Remove** the avatar — falls back to initials.
- [ ] Try uploading an oversized file (>5MB) or a disallowed type (e.g.
      `.gif`) — rejected client-side with a clear message; confirm it's
      also rejected if you bypass the client check (e.g. via devtools).
- [ ] **Forgot password**: submit a real account's email — generic success
      message. Submit an email that doesn't exist — **identical** message.
- [ ] Click the reset link — lands on `/reset-password`. Set a new
      password (test the mismatch case too) — redirected to your profile.
- [ ] Sign out, sign back in with the **new** password — works; the old
      password no longer does.
- [ ] Manually revisit an already-used confirmation or recovery link —
      redirected to `/login?error=link_invalid` with a friendly banner, not
      a crash or raw error page.
- [ ] Submit the sign-in form rapidly ~11 times in under 15 minutes — the
      11th attempt shows the rate-limit message instead of hitting
      Supabase again.
- [ ] Visit a nonexistent username at `/users/`&lt;random&gt; — the site's
      normal 404 page, not a crash.

## Testing

- **`src/lib/validation/auth.test.ts`** — every Zod schema against the
  values the database would accept/reject (username regex boundaries,
  password length, display name/bio length, avatar file size/type),
  plus the password-confirmation refinements.
- **`src/lib/auth/route-policy.test.ts`** — the full route-protection
  decision matrix (every path × auth state × onboarding state combination
  in the table above) as a pure function — no mocking needed.
- **`src/lib/supabase/session.test.ts`** — `updateSession()` itself, with
  `@supabase/ssr`'s `createServerClient` mocked (the one real external
  dependency) and a real `NextRequest`. Confirms the glue code — not just
  the decision logic — turns a policy result into an actual
  `NextResponse.redirect` with the right `location`, and confirms the
  database is never queried for public or already-denied paths.
- **`src/lib/auth/redirect-safety.test.ts`** — the open-redirect guard
  against absolute URLs, protocol-relative URLs, and embedded schemes.
- **`src/lib/rate-limit.test.ts`** — the in-memory limiter allows up to the
  limit, blocks over it, tracks keys independently, and resets after its
  window elapses.
- **Deliberately not automated**: anything requiring a real Supabase Auth
  round-trip (actual email delivery, actual PKCE code exchange, actual
  Storage upload) — that's what the manual checklist above is for. Server
  Actions that call real Supabase methods are exercised by hand, not
  mocked into a false sense of coverage.
