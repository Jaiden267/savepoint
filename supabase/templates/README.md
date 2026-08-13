# Savepoint auth email templates

Version-controlled sources for the Supabase-managed authentication emails
Savepoint actually sends. **The hosted Supabase Dashboard is the
production source of truth for live email delivery** — nothing in this
repo updates it automatically. These files exist so the templates are
reviewable, diffable, and reproducible; you still have to paste them into
the Dashboard by hand (steps below) whenever they change.

Delivery is Resend, configured as custom SMTP in the Dashboard (see
[docs/AUTH.md](../../docs/AUTH.md)) — Resend is transport only. Supabase
still renders these `.html` files (substituting its own template
variables) before handing the result to Resend; nothing here talks to
Resend directly.

## Why only two templates

Supabase supports templates for `confirmation`, `recovery`, `invite`,
`magic_link`, and `email_change`. Savepoint's application code only
triggers **signup confirmation** (`supabase.auth.signUp()` /
`supabase.auth.resend({ type: "signup" })`) and **password recovery**
(`supabase.auth.resetPasswordForEmail()`) — grepping the codebase confirms
no magic-link (`signInWithOtp`) or change-email (`updateUser({ email })`)
flow exists anywhere. Templates for `invite`/`magic_link`/`email_change`
would never be used, so they aren't built.

## Files

| File                  | Corresponds to Supabase's |
| --------------------- | ------------------------- |
| `confirm-signup.html` | `confirmation` template   |
| `reset-password.html` | `recovery` template       |

Both use only Supabase's `{{ .ConfirmationURL }}` variable — the same
variable Supabase's own default templates use — for the CTA button and a
visible plain-text fallback link. No other template variables are needed.

## Manual steps — paste into the Supabase Dashboard

For **each** template, in the Supabase Dashboard:

1. Go to **Authentication → Email Templates**.
2. Select the template named in the table above ("Confirm signup" /
   "Reset Password").
3. Set **Subject heading** to the recommended subject below.
4. Replace the **Message body (HTML)** field's entire contents with the
   full, exact contents of the corresponding `.html` file in this folder
   — copy the whole file, including the `<!doctype html>` line.
5. Save.

| Template       | Recommended Subject              |
| -------------- | -------------------------------- |
| Confirm signup | `Confirm your Savepoint account` |
| Reset Password | `Reset your Savepoint password`  |

Do this for both templates. There is no bulk/API way to push these from
this repo — Supabase's Management API does not currently expose email
template updates, and this project deliberately doesn't call it even if
it did (see CLAUDE.md: no arbitrary passthrough/administrative calls
outside their explicit, reviewed purpose).

## Design notes

- Table-based layout with every color set both inline (the default, dark)
  and via a `<style>`-block `@media (prefers-color-scheme: light)`
  override — inline styles keep the dark design working in clients that
  strip `<style>` blocks entirely; the media query improves the
  experience in clients that support `prefers-color-scheme` but the user
  has set to light.
- Colors are hex approximations of Savepoint's actual dark-theme OKLCH
  design tokens (`src/app/globals.css`) — background `#090a0c`, card
  `#111317`, border `#292c33`, foreground `#f4f4f5`, muted text `#9ca3af`.
  The accent blue (`#4c6ef5`) approximates `--primary`
  (`oklch(0.55 0.155 258)`); OKLCH can't be used directly in email HTML,
  so this is a hand-picked hex equivalent — nudge it to match exactly if
  the brand blue is refined later.
- No images, no remote fonts, no JavaScript, no forms, no tracking
  pixels — a styled text wordmark stands in for a logo so the email makes
  zero external requests.
- One obvious call-to-action button (bulletproof `<table>`-based button,
  not a bare `<a>`, for cross-client consistency), plus a visible
  plain-text fallback link showing the same URL, in case the button
  doesn't render or the recipient prefers to verify the destination
  before clicking.
- `role="presentation"` on every layout `<table>` so screen readers don't
  announce them as data tables; link text is descriptive ("Confirm your
  email" / "Reset your password"), never "click here."
