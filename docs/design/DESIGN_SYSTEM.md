# INF design system

Status: accepted implementation inventory for Tasks 9–13. This document turns
the approved visual concepts into build rules; it is not a screenshot-tracing
exercise.

## Accepted concept references

| Concept | Accepted file | Native dimensions | Route / purpose |
| --- | --- | ---: | --- |
| Owner desktop Today | `docs/design/inf-owner-desktop.png` | 1536 × 1024 | Authenticated `/` Today dashboard |
| Owner mobile Add | `docs/design/inf-owner-mobile.png` | 853 × 1844 | Authenticated `/add` capture flow |
| Anonymous public View | `docs/design/inf-public-view.png` | 1536 × 1024 | Read-only public `/view` collection |

The images establish hierarchy, density, responsive continuity, and component
anatomy. Production must use semantic HTML and CSS tokens below rather than
sampling image pixels or reproducing image artifacts.

## Product language and visible copy

INF is a private, single-user, image-first learning notebook. Its owner loop
is Capture → Organize → Resurface → Recall → Learn. It is not a marketing
site, social feed, analytics dashboard, generic bookmark manager, or AI
product.

### Owner navigation

Desktop sidebar: `INF`, `Today`, `Inbox`, `Library`, `Add`, `Review`,
`Surprise`, `Settings`. The compact theme control is icon-only. Mobile bottom
navigation: `Today`, `Inbox`, `Add`, `Library`, `Review`.

### Today (`/`)

- `Today`
- `Return to what matters.`
- `Inbox 3`, `Library 24`, `Due today 4`
- `Start review`, `Surprise me`
- `Recently added`, `Review next`
- Safe image titles: `GPU memory hierarchy`, `Transformer map`,
  `Kubernetes control plane`, `Retrieval patterns`, `TCP connection lifecycle`,
  `Git branching model`, `Operating system layers`, `Attention mechanism`,
  `B-tree fundamentals`, `HTTP request/response`
- Dates and due timing are quiet supporting text, for example `May 20, 2024`,
  `Due in 2 hours`, `Due tomorrow`, `Due in 2 days`, `Due in 3 days`.

### Add (`/add`)

- `Add infographic`
- `Paste, drop, or choose an image.`
- `Paste from clipboard`, `Choose image`, `⌘ V`
- `Optional details`, `Title`, `Source URL`, `Platform`, `Notes`
- `Save to Inbox`

### Public View (`/view`)

- `INF`
- `Infographics`
- `A public collection of visual notes.`
- Public media titles may use the safe titles listed for Today; each item shows
  only title and date.
- Footer: `INF`, `View only`.

Do not add login, account, owner navigation, edit/add/review controls, private
counts, source/platform/note fields, categories, tags, favorite/seen state,
social controls, owner prompts, or theme controls to `/view`.

## Color tokens and flat-fill rule

All production backgrounds, surfaces, selection fills, controls, borders, and
accent fills are **single, perfectly flat CSS colors**. Do not use
`linear-gradient`, `radial-gradient`, `conic-gradient`, blend modes, glossy
overlays, noise, texture, glow, bloom, or tonal shading. A gradient-like blue
in the accepted desktop and mobile concept PNGs is an explicitly approved
reference-only exception; it is prohibited in production implementation.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg-canvas` | `#FFFFFF` | `#0B0D10` | Page canvas |
| `--bg-subtle` | `#F7F8FA` | `#10141A` | Sidebar, quiet grouping |
| `--surface` | `#FFFFFF` | `#12161C` | Inputs, navigation, dialog body |
| `--surface-hover` | `#F3F6FA` | `#191F28` | Hovered quiet surface |
| `--surface-selected` | `#EAF3FF` | `#13233D` | Selected nav/row; flat fill |
| `--text-primary` | `#111318` | `#F5F7FA` | Headings and body |
| `--text-secondary` | `#667085` | `#A7B0BF` | Helper text, dates, disabled labels |
| `--text-tertiary` | `#98A2B3` | `#778191` | Placeholder and subdued metadata |
| `--border` | `#D8DEE8` | `#2B333E` | 1px hairlines and controls |
| `--border-strong` | `#B8C2D0` | `#465161` | Hovered outlines |
| `--accent` | `#2864DC` | `#2864DC` | Primary actions, selected icon/text |
| `--accent-hover` | `#1F56C3` | `#3B76EA` | Primary hover; flat fill |
| `--accent-pressed` | `#1949A8` | `#1F56C3` | Primary pressed; flat fill |
| `--focus-ring` | `#2864DC` | `#5B8EFF` | 2px focus outline |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` | Text/icon on primary fill |
| `--success` | `#16794A` | `#4FD18B` | Success only |
| `--warning` | `#A65D00` | `#FFBC5B` | Warning only |
| `--danger` | `#C83333` | `#FF7474` | Destructive/error only |
| `--info` | `#2864DC` | `#5B8EFF` | Informational state |

Semantic colors communicate state only; they are not decorative accents.

## Typography

Use the platform system sans stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont,
"Segoe UI", sans-serif`. No remote-font branding. Default optical weight is
regular; headings are compact and decisive, with no display/marketing scale.

| Role | Size / line-height | Weight | Use |
| --- | --- | ---: | --- |
| App wordmark | 24px / 28px desktop; 20px / 24px mobile | 700 | `INF` |
| Page title | 40px / 48px desktop; 32px / 40px mobile | 700 | `Today`, `Infographics`, `Add infographic` |
| Section title | 22px / 28px | 650–700 | `Recently added`, `Review next`, `Optional details` |
| Body / action | 16px / 24px | 400; 600 for actions | Body, nav, buttons, fields |
| Media title / row title | 16px / 22px | 600 | Image captions and review rows |
| Supporting copy | 16px / 24px | 400 | Route helper line |
| Metadata / label | 14px / 20px | 400–500 | Dates, field labels, due timing |
| Compact UI | 13px / 18px | 500 | Status values, shortcut hint |
| Bottom-nav label | 12px / 16px | 500 | Mobile navigation |

Use `letter-spacing: -0.02em` only for page titles; all other text uses normal
tracking. Text wraps naturally; truncate a single-line media title only after
two lines are infeasible, with an accessible full name retained.

## Layout, spacing, and responsive continuity

Use the 4px base scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80`px. Prefer
8px increments for component gaps and 24/32px for section separation.

| Region | Desktop | Mobile |
| --- | --- | --- |
| App shell | Fixed 216px sidebar + fluid main | One-column shell + fixed bottom nav |
| Main container | `max-width: 1440px`; 40–56px inline padding | 20px inline padding |
| Public collection | `max-width: 1440px`; 56px inline padding | 20px inline padding |
| Sidebar | 216px wide; 24px top/inline padding | Hidden below 768px |
| Bottom navigation | Hidden at 768px and up | Fixed bottom; 72px content height + `env(safe-area-inset-bottom)` |
| Desktop media rail | Four 1fr media frames, 16px gap; horizontal overflow only below available fit | Horizontally scrollable, 76–84vw cards, 16px gap, scroll-snap |
| Public grid | Three equal columns, 24px gap | One column below 640px; two columns from 640–1023px; three from 1024px |

Breakpoints: mobile `<640px`; compact/tablet `640–767px`; app desktop `≥768px`;
wide public layout `≥1024px`. At 768px switch navigation systems atomically:
there is never both a fixed sidebar and bottom nav. Keep bottom padding at
least `72px + env(safe-area-inset-bottom) + 16px` so controls cannot hide behind
the mobile bar. Body scrolls; desktop sidebar and mobile nav remain fixed.

Use `overflow-x: auto` only for intentional media rails, with `scroll-snap-type:
x proximity`, visible keyboard focus, and no clipped interactive controls.
Never introduce a horizontally scrolling full page or a nested vertical scroll
area for basic route content.

## Component families

### Navigation

- **Sidebar:** 216px, full height, `--bg-subtle`, 1px right border; nav row
  height 44px, 8px radius, 12px inline padding, 12px icon/text gap. Active
  state uses `--surface-selected` plus accent icon/text, not a pill or shadow.
  Settings anchors at the bottom; theme toggle is a compact segmented control.
- **Bottom nav:** flat surface with 1px top border, five equal targets, each
  minimum 44×44px touch target. Use 24px icon over 12px label. Active Add is
  centered but remains part of the bar—never a floating action bubble.

### Buttons

All buttons have 8px radius, 44px minimum height, 16px action type, 600 weight,
16px horizontal padding, 8px icon gap, and a visible `:focus-visible` ring.

| Variant | Default | Hover / pressed | Disabled |
| --- | --- | --- | --- |
| Primary | Flat `--accent`; `--on-accent` text | Flat `--accent-hover` / `--accent-pressed` | Muted flat surface; no shadow |
| Secondary | `--surface`, 1px `--border`, primary text | `--surface-hover`, `--border-strong` | Muted text/border |
| Tertiary / quiet | Transparent, primary or accent text | `--surface-hover` | Muted text |
| Destructive | Flat `--danger`, white text | Darker flat red | Muted destructive text/surface |

The mobile save action is full width. `Paste from clipboard` is primary;
`Choose image` is secondary. Loading substitutes an inline spinner and preserves
button width; it must not use shimmer animation.

### Fields and capture area

- **Field:** 44px input minimum; textarea 104–120px; 8px radius; 1px border;
  12px inline padding; flat `--surface`. Label sits 8px above. Placeholder uses
  tertiary text. Hover strengthens border; focus changes only to 2px focus ring
  and accent border; invalid adds semantic error text and `--danger` border.
- **Capture region:** 2px dashed accent border, 12px radius, 24px padding,
  centered image icon and controls. It supports paste, drop, and file chooser;
  drag-over is a flat selected surface, not a glow.

### Content display

- **Media frame:** stable aspect ratio (desktop rail `4 / 3`; public collection
  `16 / 9` to `4 / 3` according to source); `object-fit: cover` for photos and
  `contain` on a flat neutral media background for diagrams; 8px radius; 1px
  hairline; no surrounding card. Hover/selected uses only a 1–2px accent outline.
- **Caption:** title then date with 4px gap; title remains visually attached to
  its frame; the public view exposes no metadata beyond title/date.
- **Status row:** transparent/open row with 1px vertical separators, 16px icon,
  compact text, and no floating card wrapper.
- **Review row:** 64×48px thumbnail, title, quiet due timing aligned to the
  far edge; 16px vertical rhythm; 1px row divider. It is not a metric, chart,
  streak, score, or gamified component.
- **Empty state:** reserved for empty Inbox/Library/Review; use one 24px outline
  icon, a concise factual title, one short helper sentence, and at most one
  relevant action. No illustration, hero, colored panel, or decorative badge.
- **Dialog:** only when a decision needs interruption. Max width 480px desktop,
  inset 20px mobile, 12px radius, 24px padding, flat surface, hairline border,
  restrained scrim, title/body/actions anatomy. Escape and overlay close unless
  destructive confirmation requires an explicit choice; restore focus on close.

## Iconography and interaction

Use Lucide icons with round linecaps/joins, `stroke-width: 1.75`, never filled
except where Lucide itself requires a small structural fill. Default size is
20px; use 16px in status rows and 24px in bottom navigation/capture empty
states. Align to the text baseline rather than optical decoration.

| Purpose | Lucide name |
| --- | --- |
| Today | `House` |
| Inbox | `Inbox` |
| Library | `BookOpen` |
| Add | `Plus` |
| Review | `RefreshCw` |
| Surprise | `Sparkles` |
| Settings | `Settings` |
| Theme | `Sun`, `Moon` |
| Capture | `Image` |
| Date / due | `CalendarDays` |
| Clipboard paste | `ClipboardPaste` |
| Close dialog | `X` |

Icon-only controls require an accessible name and a 44px target. Do not create
decorative icon rows, logo illustrations, or nonfunctional controls.

## Motion, accessibility, and image treatment

Keep motion restrained: 120–160ms `ease-out` for color, border, and opacity;
no springy entrance, parallax, shimmer, or looping decoration. Under
`prefers-reduced-motion: reduce`, remove nonessential transitions and scroll
animation; state changes remain immediately legible.

Meet WCAG AA contrast, preserve visible keyboard focus, use semantic landmarks
and labels, and ensure all controls are keyboard reachable. Media images use
descriptive alt text based on the safe title; public images must not reveal
private notes, sources, platforms, owner data, or image metadata. Use stable
aspect-ratio boxes to avoid layout shift; images supply most visual color while
all application chrome stays neutral and flat.

## Fidelity guardrails

Allowed: open layouts, lists, rails, practical forms, fixed navigation,
hairlines, 8–12px functional radii, sparse focus elevation for dialogs only,
and one restrained selected/hover outline.

Prohibited: gradients; glows; heroes; marketing claims; eyebrow/kicker text;
decorative pills/badges; bento/default card grids; fake metrics/charts;
excessive shadows; giant rounded wrappers; remote-font branding; analytics;
AI-facing language or controls; social patterns; watermarks; unrelated routes;
or public exposure of owner controls/private metadata.

Human approval accepted all three PNG concept references, including the
documented tonal-fill exception. That approval does not relax the production
flat-fill ruling above. Implement visual continuity in structure, typography,
spacing, media prominence, and responsive behavior—not through visual effects.
