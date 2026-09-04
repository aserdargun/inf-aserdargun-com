# Infographics Evolutionary 2.0 design system

Status: accepted implementation contract, 2026-08-30.

Infographics is a private, single-user, image-first learning notebook. The
visible product name is always `Infographics`; `INF` is reserved for favicon,
installed-app icon, and similarly constrained icon contexts. The interface uses
existing data and workflows only. Anonymous access remains limited to
`/view/*` and `/api/public/*`.

## Foundations

The UI uses the local system sans-serif stack and no network font. Body copy is
16px/1.55, metadata is 14px/1.5, and compact navigation labels are 13px at
weight 650. Page titles use
`clamp(2.125rem, 1.75rem + 1.4vw, 3.25rem)` and section titles use
`clamp(1.375rem, 1.2rem + 0.45vw, 1.75rem)`.

### Semantic color tokens

| Token | Light | Dark |
| --- | --- | --- |
| `--bg-canvas` | `#F3F0E7` | `#0C0F0D` |
| `--surface` | `#FFFEFA` | `#141814` |
| `--navigation-surface` | `rgba(255, 254, 250, 0.86)` | `rgba(20, 24, 20, 0.86)` |
| `--bg-subtle` | `#E9E5DA` | `#20261F` |
| `--text-primary` | `#171915` | `#F6F3EA` |
| `--text-secondary` | `#60665D` | `#AFB5AA` |
| `--border` | `#D3CEC1` | `#323A32` |
| `--border-strong` | `#A9A397` | `#596257` |
| `--accent` | `#365FE5` | `#88A1FF` |
| `--accent-hover` | `#294FCB` | `#9DB2FF` |
| `--success` | `#16806A` | `#67CBB3` |
| `--danger` | `#B23A3A` | `#FF8D8D` |
| `--focus-ring` | `#3157D5` | `#9DB2FF` |

Content surfaces are opaque. Translucency and the single soft overlay shadow
are limited to navigation, dialogs, and the transient Library filter panel.
Compact controls use a 10px radius, media and major states 16px, and floating
tablet navigation 18px. CSS transitions are 140–200ms; nonessential motion is
disabled under `prefers-reduced-motion`.

## Responsive shell

- Desktop is `min-width: 1100px`: fixed 248px left rail, full wordmark, owner
  destinations, Settings, theme control, and 48–64px content gutters.
- Tablet is `768px–1099px`: sticky brand bar plus floating five-item bottom
  navigation, with Settings in the top bar and 32–40px content gutters.
- Mobile is `max-width: 767px`: attached five-item bottom navigation, top
  Settings access, 20px gutters, and safe-area-aware bottom padding.

The bottom navigation is Today, Inbox, Add, Library, and Review with visible
labels. Each primary action and navigation target is at least 44×44 CSS pixels,
and fixed navigation must not obscure focused content.

## Shared component contracts

- `AdaptiveNavigation` selects the desktop rail, tablet material navigation, or
  attached mobile navigation without changing route or accessible names.
- `PageHeader` keeps route title, description, and action hierarchy consistent.
- `PageState` provides bounded compact or media-stage loading, empty, and error
  compositions with at most one primary action.
- `MediaCanvas` provides stable thumbnail, gallery, detail, preview, review, and
  surprise frames. Informational images always use `object-fit: contain`.
- `LibraryFilters` provides search-first desktop controls and an accessible
  native dialog with active-filter count on tablet/mobile. URL state remains
  authoritative.
- Inbox disclosure and the owner detail inspector provide progressively dense
  metadata editing without changing field or API contracts.
- `StatusRow` presents health, storage, version, and counts as comparable
  label/value pairs; status never relies on color alone.
- Buttons preserve primary, secondary, quiet, and destructive roles, pending
  and disabled feedback, two-pixel focus treatment, and 44px minimum height.

## Route and state layouts

| Surface | Populated composition | Loading / empty / error contract |
| --- | --- | --- |
| Public gallery | Compact header, bounded heading, 3/2/1 contain-media grid | Bounded editorial state near the heading |
| Public detail | Return link, title/date, maximum readable contain-media | Generic public-only unavailable/retry state |
| Login | Two-part desktop, single-column mobile, one GitHub primary action | Pending action and safe retry copy |
| Today | Existing counts, primary Review action, stronger recent/review media | Bounded completion or recovery state |
| Add | Dominant picker before selection; compact picker, preview, details, save after selection | Local validation preserves selected media and values |
| Inbox | Desktop triage queue and larger media; collapsed metadata editors on mobile | Bounded load, empty, sync, and save feedback |
| Library | Search-first filters and 4/3/2/1 contain-media grid | Distinct empty, filtered-empty, and retry states |
| Owner detail | Dominant media plus sticky 340px inspector; ordered single column on mobile | Missing/retry state and destructive confirmation dialog |
| Review / Surprise | Focused contain-media stage and equal-size labelled controls | Caught-up, unavailable, and retry stage states |
| Settings | Appearance, Connection health, Data health, Backup and recovery, Application details | Operational loading/retry states with safe export errors |

All routes preserve their existing copy, DTOs, request order, Drive/Blob/cache
behavior, service-worker behavior, and GitHub exact-owner authorization.

## Validation matrix

Automated validation includes lint, TypeScript, API/web production builds,
artifact and lifecycle verification, Vitest, Playwright route coverage, visual
evidence checks, and `git diff --check`.

Rendered validation covers 1440×1024 desktop, 1024×768 landscape tablet,
820×1180 portrait tablet, and 390×844 mobile in light/dark and default/reduced
motion. Keyboard-only validation Tabs through the real rendered focus order at
all four viewports, requires every reached control to remain visible, and proves
content focus stays above fixed bottom navigation. The 200% zoom check halves
the desktop/tablet layout viewport while using a 2× device scale; the mobile
check uses a 2× visual page scale while retaining its 390px layout viewport.
Both models assert no horizontal page overflow, visible keyboard focus, and
bottom-navigation non-obscuration. The matrix also checks page identity,
meaningful DOM, console health, 44×44 targets, contain media, and expected state
changes. The representative paths are public gallery → detail → login; Today →
Add → Inbox; Inbox → Library → owner detail; Review rating → completion;
Surprise → detail; and Settings appearance/health/export.

Release evidence is deterministic, browser-rendered, and has no browser chrome:
owner/public desktop at 1280×720 and owner/public mobile at 390×844.
