# Design system

Savepoint's design reference — tokens, layout patterns, component
conventions, and accessibility rules established (or formalized) in
Prompt 8. This is a live pass over the existing app, not a redesign: no
product scope changed. See [PROJECT_STATE.md](./PROJECT_STATE.md) for what
was actually touched and verified.

## Design tokens (`src/app/globals.css`)

Dark-first, no light theme, no toggle. All colors are OKLCH (the project's
existing format); the palette below was retuned from the spec's hex
targets via a real OKLCH conversion, not eyeballed.

| Token                                       | Role                                                                                                                                                | ~Hex                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `--background`                              | Page background                                                                                                                                     | `#090a0c`            |
| `--surface-1`                               | First elevation (available for future use — no current component reaches for it directly; cards currently sit at `--surface-2`)                     | `#111317`            |
| `--card` / `--popover` (= `--surface-2`)    | Second elevation — cards, dialogs, the drawer, popovers                                                                                             | `#17191e`            |
| `--border` / `--input`                      | Solid neutral border (was alpha-white; switched to solid so it reads consistently against poster art edges)                                         | `#292c33`            |
| `--border-subtle`                           | The old alpha-white value, kept for overlays laid directly on artwork (e.g. `game-hero.tsx`'s gradient scrim) where a solid border would look wrong | `oklch(1 0 0 / 10%)` |
| `--foreground`                              | Primary text                                                                                                                                        | `#f4f4f5`            |
| `--muted-foreground`                        | Secondary text                                                                                                                                      | `#9ca3af`            |
| `--primary` / `--ring`                      | The one accent — selection, focus rings, primary actions. No second accent exists.                                                                  | unchanged            |
| `--destructive` / `--success` / `--warning` | Reserved for status meaning only, never chrome                                                                                                      | unchanged            |

`:root` holds the full palette; `.dark` is intentionally left empty rather
than a byte-for-byte duplicate (the app is dark-first with `className="dark"`
always forced — there's no light path to diverge from, so keeping two
copies in sync was a needless hazard).

**Spacing**: Tailwind v4's default `--spacing: 0.25rem` (4px) already gives
the 4/8px rhythm — no new spacing token was added. Off-grid arbitrary
values (`px-[…]`, `w-[…]`, etc.) were treated as an audit signal, not a
mechanical find-and-replace: values required for `env(safe-area-inset-*)`,
poster/artwork aspect-ratio math, or icon/control sub-pixel alignment are
kept as-is and are not violations.

**Shadows**: Tailwind v4's default `shadow-xs/sm/md/lg` scale, used ad hoc
(dialog/drawer popups, tabs indicator) — no bespoke `--shadow-*` tokens
were needed.

**Motion**: `--duration-fast` (120ms) / `--duration-base` (180ms) /
`--duration-slow` (240ms) in `@theme inline`, for components to stop
hardcoding `duration-200` ad hoc. See "Reduced motion" below for the
`prefers-reduced-motion` rule — it's targeted, not blanket.

## Typography

`Heading`/`Text` in `src/components/common/typography.tsx` (CVA-based,
unchanged this pass) remain the size/tone scale. `PageHeader`
(`src/components/common/page-header.tsx`, new) wraps `Heading level="h3"
as="h1"` + an optional muted description + an optional trailing action —
the standard shape for a route's top-of-page title. It replaced the same
hand-written block duplicated across `/home`, `/discover`,
`/discover/community`, `/search`, `/diary`, `/library`, `/lists/new`,
`/settings/profile`.

**Not every route uses `PageHeader`.** Routes with a custom header shape —
a badge next to the title (`/lists/[id]`), an avatar + stats grid
(`/users/[username]`), a centered auth card (`AuthCard`) — keep their own
layout. `PageHeader` is for the plain "title (+ description) (+ action)"
case, not a mandate.

**Container widths** are chosen per content density, not standardized to
one value: narrow (`max-w-lg`/`max-w-sm`) for single-column forms
(settings, onboarding, auth), wider (`max-w-3xl`–`max-w-6xl`) for grids and
lists. This was already the existing convention; Prompt 8 didn't change it,
just confirmed it's intentional. Long-form text content (e.g. `/privacy`)
also uses `max-w-3xl` — narrow enough for a comfortable reading measure,
without introducing a new container size.

## Footer link pattern

`SiteFooter` (`src/components/layout/site-footer.tsx`, renders once from
the root layout, so it's identical on every route) is a three-item flex
row: copyright, then any footer nav links, then the tagline — `justify-between`
on `sm:` and up naturally centres a lone middle link between the two
outer lines; `flex-col items-center` on mobile stacks the same order
centred. A footer link uses `LinkButton` `variant="link" size="sm"` (real
`<a>` semantics, the shared focus-visible ring, an adequate touch target
from the button primitive's own sizing) rather than a bare styled `<a>`,
so it doesn't need its own one-off focus/touch-target styling. `/privacy`
was the first link added here (Prompt 9+1 content pass).

## Surface & border hierarchy

- `--background` — the page itself.
- `--surface-2` (`--card`/`--popover`) — anything visually raised: cards,
  dialogs, the drawer, popovers, the header's blurred backdrop.
- `--border` — the default neutral border everywhere, including on poster
  art wrappers.
- `--border-subtle` — only for overlays painted directly on artwork
  (gradient scrims), where the alpha version reads better against a photo
  than a solid line would.

## Poster/card conventions

`PosterCard`/`PosterCardSkeleton`/`PosterGrid` (`src/components/games/`)
are unchanged this pass — already CLS-safe (`next/image` `fill` inside an
`aspect-[3/4]` wrapper with a `sizes` attribute) and already the shared
grid shape (`grid-cols-2 sm:3 md:4 lg:5`). `PosterGrid` now exports its
`GRID_CLASSES` string so routes that render a different card component in
the same grid shape (`LibraryEntryCard` on `/library` and
`/users/[username]/library`) import the same constant instead of
retyping it.

## Responsive layout patterns

**Desktop nav** (`≥768px`, `md:`): unchanged — a single `<nav
aria-label="Primary">` in `site-header.tsx`.

**Mobile nav** (`<768px`): two new pieces, both in `src/components/layout/`:

- `MobileNavBar` — a fixed bottom tab bar for the 5 primary signed-in
  destinations (Home, Discover, Search, Library, Diary), rendered only
  when signed in. Active tab uses more than color: a filled icon
  (`fill="currentColor"` vs `none`), a small indicator bar, bolder label
  weight, and `aria-current="page"`.
- `MobileNavDrawer` — a hamburger trigger opening a right-anchored
  `Drawer` (new primitive, below) with Community/Profile/Settings/Sign-out
  (or Sign in/Sign up when signed out).

Both receive `user`/`username` as props from `site-header.tsx`'s single
existing Supabase fetch — no duplicate auth queries.

**Bottom-bar spacing is conditional, not global.** `MobileNavBar` marks its
root `<nav>` with a plain `data-mobile-nav-bar` attribute. `globals.css`
reserves matching `padding-bottom` on `<body>` via `body:has([data-mobile-nav-bar])`,
scoped inside `@media (max-width: 767px)` so it self-cancels at `md` and
above (`:has()` matches DOM presence regardless of the bar's own
`md:hidden`, so the media-query wrapper — not the bar's own responsive
class — is what makes this correct on desktop). Signed-out pages, which
never render the bar, get zero extra padding — no unexplained gap, and
nothing covers a page's final content row, action, or error state. The
reserved value (`3.5rem + env(safe-area-inset-bottom)`) is kept in sync by
construction: the bar's own height is a fixed `h-14` (3.5rem) plus its own
safe-area spacer element, not measured/guessed independently.

**Profile tab bar** (`ProfileNav`, 5 tabs): already had `overflow-x-auto`
for narrow viewports; this pass added `scroll-fade-x` (a real, unused-until-now
Tailwind v4 utility already shipped via `shadcn/tailwind.css`) so the
scrollable edge fades instead of hard-clipping.

## The Drawer primitive (`src/components/ui/drawer.tsx`)

Wraps `@base-ui/react/drawer` (already a dependency, previously unused — no
new package). Mirrors `dialog.tsx`'s structure (`Root/Trigger/Portal/
Backdrop/Popup/Title/Description/Close`), verified against the installed
package's real `.d.ts` files rather than assumed:

- No `side` prop exists. Direction is `swipeDirection="up"|"down"|"left"|"right"`
  (default `"down"`) — this project's usage sets `swipeDirection="right"`
  for the edge-anchored nav panel.
- `Popup` **must** render inside `Viewport` — omitting it silently disables
  touch scroll-locking and swipe handling (a real defect caught by
  `drawer.test.tsx`, not assumed from the props existing; `Viewport` owns
  the fixed edge positioning, `Popup` owns the visual surface + enter/exit
  transform).
- `modal` defaults to `true` (focus trap + page scroll lock + outside
  pointer interactions disabled) — correct default for a nav drawer, no
  override needed.
- Focus trap, focus-on-open, focus-return-on-close, Escape-to-close,
  backdrop-click-to-close, and scroll lock are all confirmed by real tests
  in `drawer.test.tsx` — not assumed from the primitive's docs.

Only `Root/Trigger/Portal/Backdrop/Popup/Title/Description/Close` are used.
`Handle`/`SwipeArea`/`Indent`/snap-point props exist on the primitive for
bottom-sheet/nested-drawer use cases and are deliberately not wired in for
this single flat nav drawer.

**Composition pitfall found and avoided**: composing a nav `<Link>` via
`DrawerClose`'s `render` prop (`<DrawerClose render={<Link .../>}>`) forces
`role="button"` onto the composed element regardless of the `nativeButton`
flag, breaking real link semantics — the same trap `link-button.tsx`'s own
comment already documents for Base UI's `Button`. `MobileNavDrawer` uses a
controlled `Drawer` (`open`/`onOpenChange` state) with plain `<Link
onClick={() => setOpen(false)}>` elements instead.

## Pagination

`src/components/common/pagination.tsx` (new) replaces the identical
hand-rolled `<nav aria-label="Pagination">` two-button block that was
duplicated across `/discover`, `/diary`, `/library`, and all six
`/users/[username]/*` tabs. `<Pagination page hasMore makeHref />` — each
route keeps its own `makeHref` query-string shape. `/home`'s cursor-based
"Load more" is a different pattern and was left as-is, not forced into
this component.

## Form & feedback patterns

- **Labels**: every input needs a real `<label htmlFor>` or `aria-label` —
  a `placeholder` alone is not a label. Found and fixed two real gaps this
  pass: the note `<Textarea>` in `list-item-row.tsx` had no label at all
  (placeholder-only); the hamburger/close controls in the new mobile nav
  needed explicit `aria-label`s (there was no visible text to fall back
  on).
- **Field errors**: `FieldError` (`src/components/common/field-error.tsx`)
  — `role="alert"`, an `id` wired to the field via `aria-describedby`. Used
  by every multi-field form (auth, `list-form`, `profile-form`). Found and
  fixed one real gap: `avatar-uploader.tsx`'s client-side file-validation
  error rendered as a bare, unassociated `<p>` — now a real `FieldError`
  with `aria-describedby`/`aria-invalid` wired to the file input, alongside
  its existing helper text (both ids present in `aria-describedby`
  simultaneously).
- **Single-field forms** (comment composer, list-item note) rely on
  `FormAlert`'s form-level banner alone — there's no second field to
  disambiguate, so a dedicated `FieldError` would be redundant, not a gap.
- **Pending state**: `SubmitButton` (`useFormStatus`, `aria-busy`) — already
  the standing convention, confirmed present on every form.

## Destructive actions

`DeleteListButton` / `DeleteDiaryEntryButton` establish the pattern: a
`Dialog` with a `DialogTitle`/`DialogDescription` explaining the
consequence, a secondary "Cancel" (`DialogClose`), and a destructive submit
inside its own `<form>`. Review deletion (via `review-composer.tsx`) already
follows the identical shape. Any new destructive control should match this,
not invent a new confirmation pattern.

## Accessibility rules

**Touch targets — real sizing, not overlapping pseudo-elements.**
Invisible hit-area extension (`after:absolute after:inset-[-8px]`) was
considered and rejected: adjacent controls' extended hit areas can overlap
and cause mis-taps, which is worse than the problem it solves. Instead:

- Primary mobile controls (bottom-tab-bar items, drawer hamburger/close)
  get a real **≥44×44 CSS px** box — `min-h-11`/`min-w-11` on the actual
  interactive element, with the visible icon staying visually small and
  centered inside via flex centering.
- Every other custom control needs a real **≥24×24 CSS px** box (WCAG 2.2
  SC 2.5.8). `reorder-controls.tsx`'s four `icon-sm` (28px) buttons already
  clear this floor — audited, no change needed.

**Reduced motion — targeted, not blanket.** `globals.css`'s
`prefers-reduced-motion: reduce` block shortens `transition-duration`
globally to `--duration-fast` (a real, non-zero duration — Base UI's
Dialog/Drawer open/close lifecycle relies on a genuine transition
completing, not an instant one) and shortens `animation-duration` for
everything **except** `.animate-spin`. The two real spinners in this
codebase (`submit-button.tsx`'s pending-state spinner, `add-game-to-list-dialog.tsx`'s
per-row import-in-progress spinner) are functional "operation in progress"
indicators, not decorative — freezing or hyper-accelerating them under
reduced motion would misrepresent an in-progress state, which is exactly
what a blanket rule would have done. Decorative hover-scale transforms
(`poster-card.tsx`'s `group-hover:scale-105` and similar) are neutralized
outright via `*:hover { scale: 1 !important }`.

**Spoiler reveal** (`review-card.tsx`): the reveal button now carries
`aria-expanded={false}`/`aria-controls` pointing at the (not-yet-rendered)
body paragraph's id, and the surrounding container is `aria-live="polite"`
so screen readers announce the body's appearance on reveal — previously
neither was present.

**Icon-only controls** need a real accessible name. Found one pre-existing
gap unrelated to the new mobile nav: `SearchCommandDialog`'s ⌘K trigger
lost its only accessible name below `sm:` (the label text is `hidden` at
that breakpoint, which removes it from the accessible tree) — fixed with
an explicit `aria-label="Search games"` on the trigger itself.

**Nested interactive controls**: `PosterCard`, `LibraryEntryCard`,
`StatLink` (profile stats grid) are all confirmed clean — a `Link`
wrapping only static content, never another interactive element.

## Testing

`vitest-axe` (`^0.1.0`) is a new devDependency — a real axe-core scan
wired into the components most likely to regress (the new `Drawer`,
`MobileNavBar`, `MobileNavDrawer`, `PageHeader`, `Pagination`, plus a
`toHaveNoViolations`-style smoke check on `star-rating-input.tsx` and 2–3
spot-checks on existing route-level tests), not blanket-added to every
test file.

**Its own `toHaveNoViolations()` matcher's type declarations don't work
against this project's Vitest 4** — confirmed by an isolated repro, not
assumed from the version number. `src/test/axe.ts` exports a small,
fully-typed `expectNoAxeViolations(results)` helper built directly on the
raw `axe-core` results object instead; every axe-scan test in this repo
uses that helper, not the matcher.

## Reusable-component guidance

Before writing a new one-off:

- Page title → `PageHeader`, unless the route needs a custom header shape.
- Prev/next page-number pagination → `Pagination`.
- Poster grid class string → import `GRID_CLASSES` from `poster-grid.tsx`.
- Edge-anchored overlay panel → `Drawer` (mirrors `Dialog`'s API shape).
- Field-level validation error → `FieldError`, wired via `aria-describedby`.
- Destructive confirmation → the `Dialog` pattern in
  `delete-list-button.tsx`/`delete-diary-entry-button.tsx`.
- Axe assertion in a test → `expectNoAxeViolations(await axe(container))`
  from `@/test/axe`, not `vitest-axe`'s own matcher.
