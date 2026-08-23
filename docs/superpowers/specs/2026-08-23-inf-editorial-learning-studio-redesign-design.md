# INF Editorial Learning Studio Redesign

**Status:** Approved design direction, implementation pending written-spec review

**Date:** 2026-08-23

## Goal

Redesign every visible INF surface as a coherent, modern editorial learning studio while preserving the existing application behavior, routes, GitHub owner authentication, Google Drive integration, public/private boundary, and Azure Static Web Apps deployment model.

The redesign must make infographics feel like the primary material of the product. Public pages should read as a curated visual archive; authenticated pages should feel like a focused workspace for capturing, organizing, and reviewing that archive.

## Product boundaries

### In scope

- Shared visual foundations: color, typography, spacing, radii, surfaces, focus, motion, and responsive containers.
- Public gallery and public infographic detail.
- Owner login.
- Authenticated shell and navigation.
- Today, Add, Inbox, Library, infographic detail, Review, Surprise, and Settings.
- Loading, empty, error, success, destructive confirmation, and populated states.
- Desktop, tablet, and mobile layouts.
- Accessibility and regression coverage for the redesigned surfaces.

### Out of scope

- Changes to authentication or exact-owner authorization.
- New data fields, API contracts, storage providers, or Google Drive folder structure.
- New routes or a new information architecture.
- Social, collaboration, sharing, commenting, or public editing.
- AI features.
- Custom-domain, DNS, or certificate work.
- Copy localization. Existing English product copy remains unless a small change is required for clarity or accessibility.

## Design principles

1. **The infographic is the hero.** Media receives the strongest visual weight on gallery, library, detail, review, and surprise screens.
2. **Editorial, not decorative.** Hierarchy comes from scale, spacing, alignment, and typography before borders, shadows, or gradients.
3. **Purposeful states.** Today, Inbox, Library, and Review must not reuse one generic empty panel. Each empty state explains the screen's role and offers one appropriate next action.
4. **A single product identity.** Public, login, and authenticated areas use the same wordmark, type scale, spacing logic, colors, and component language.
5. **Calm productivity.** Owner tools remain efficient. The redesign must not add marketing sections, invented metrics, extra dashboard widgets, or decorative feature cards.
6. **Progressive density.** Public pages remain spacious and visual; admin workflows become denser only where forms, metadata, or operational information require it.
7. **Accessible by default.** Text, controls, focus, contrast, motion, and responsive behavior must work without relying on color or pointer input alone.

## Visual system

### Palette

The light theme uses a warm editorial canvas rather than pure white, with neutral paper surfaces and strong ink text.

- Canvas: `#F5F2EA`
- Primary surface: `#FFFEFA`
- Subtle surface: `#ECE8DE`
- Primary text: `#171915`
- Secondary text: `#62675E`
- Border: `#D7D2C7`
- Strong border: `#AFA99D`
- Primary accent: `#3157D5`
- Primary accent hover: `#2749BB`
- Secondary accent: `#16806A`
- Danger: `#B63C3C`
- Focus: `#3157D5`

The dark theme uses near-black ink surfaces without changing the semantic meaning of tokens.

- Canvas: `#10120F`
- Primary surface: `#171A16`
- Subtle surface: `#1E221D`
- Primary text: `#F5F2EA`
- Secondary text: `#AEB3A8`
- Border: `#343A32`
- Strong border: `#596156`
- Primary accent: `#7892F3`
- Primary accent hover: `#91A5F7`
- Secondary accent: `#62C6AE`
- Danger: `#FF8787`
- Focus: `#91A5F7`

Color roles remain semantic and expose sufficient contrast. The public view follows the saved theme when available but defaults to light; owner pages continue to support explicit theme switching.

### Typography

- Use the existing local/system font path; do not add a network font dependency.
- Page title: 48/52 desktop, 36/40 mobile, weight 650-700, slightly negative tracking.
- Section title: 24/30 desktop, 22/28 mobile, weight 650.
- Body: 16/25.
- Supporting and metadata text: 14/21.
- Labels and compact navigation: 13/18, weight 600.
- Long copy stays within approximately 65 characters per line.
- INF remains a text wordmark; no fabricated logo asset is required.

### Shape and depth

- Controls and compact surfaces: 10px radius.
- Media frames and major empty states: 16px radius.
- Pills are reserved for real tags or statuses; ordinary buttons remain rounded rectangles.
- Use borders and surface contrast before shadows.
- A single soft shadow may appear on elevated overlays such as dialogs; gallery and workflow cards remain flat.

### Icons and motion

- Keep one consistent outline icon family and optical weight across navigation and actions.
- Icons never replace visible labels for primary actions.
- Hover and selection transitions use 140-180ms easing.
- Page content may use a restrained opacity/translate entrance, but no staggered ornamental animation.
- `prefers-reduced-motion` disables nonessential motion.

## Layout architecture

### Authenticated desktop shell

- Fixed left rail grows from 216px to 248px.
- Rail contains the INF wordmark, seven existing routes, and theme control.
- Main content uses a centered fluid container up to 1280px with 64px desktop gutters.
- Every screen uses the same page-header contract: eyebrow only when it communicates state, title, short supporting copy, and a right-aligned action group when actions exist.
- Wide screens must not leave the functional content in a narrow corner. Forms and operational pages use purpose-built columns within the shared container.

### Authenticated mobile shell

- Preserve the existing five-item bottom navigation for Today, Inbox, Add, Library, and Review.
- Preserve Settings in the top bar.
- Reserve bottom safe-area space so content and labels cannot be obscured.
- Keep labels visible; do not switch to icon-only navigation.

### Public shell

- Use the same INF wordmark and typography as the owner product.
- Header remains compact and contains only the wordmark and `Admin sign in`.
- Footer remains minimal and identifies the surface as view-only.
- Gallery content uses a wider editorial grid with generous media scale and stable aspect ratios.

## Screen specifications

### Public gallery

- Lead with `Infographics` and the existing public description.
- Use a three-column editorial grid on wide desktop, two columns on tablet, and one column on mobile.
- Increase media presence; captions sit below imagery without enclosing every item in a card.
- Show title and date from existing data only.
- Preserve the current anonymous API and detail-link behavior.
- Empty and error states remain visible within the gallery composition rather than floating in unused canvas.

### Public detail

- Keep a clear return link, title, date, and full infographic.
- Use a media-first container that maximizes readable image size without cropping.
- Do not expose private metadata or owner actions.

### Login

- Use a two-part desktop composition: a concise editorial brand statement and a focused sign-in panel.
- Collapse to one column on mobile.
- Keep `Continue with GitHub` as the sole primary authentication action.
- Add a visible link back to the public gallery.
- Preserve all current redirect and error behavior.

### Today

- Establish a strong page header and group `Start review` and `Surprise me` as the screen's primary actions.
- When data exists, keep existing status and media sections but use larger media and clearer section separation.
- When no items need attention, use a spacious state that explains the next useful action without imitating an error panel.

### Add

- Desktop uses two columns: capture/preview on the left and optional details plus save action on the right.
- Mobile stacks capture, preview, details, and save in task order.
- Keep clipboard, file input, validation, and save behavior unchanged.
- The selected image preview must remain visible while editing metadata.
- The save action remains visually anchored to the details column and is not an oversized decorative bar.

### Inbox

- Keep Drive sync in the page-header action group.
- Use the existing list model for pending items, with a stronger thumbnail column and clearer metadata editing groups.
- The empty state distinguishes manual capture from Drive synchronization without inventing another workflow.

### Library

- Preserve existing search, category, platform, and favorite filters.
- Filters form a compact toolbar above the grid rather than a separate dashboard panel.
- Use four media columns only when item width remains readable; collapse responsively to three, two, and one as space requires.
- Selected, hover, and keyboard focus states remain visually distinct.

### Owner infographic detail

- Keep the infographic as the dominant column.
- Place metadata and existing actions in a stable secondary column on desktop and below the media on mobile.
- Preserve delete confirmation and all history information.

### Review and Surprise

- Treat both as focused learning stages with a constrained reading width.
- The infographic receives the largest possible area above rating or navigation controls.
- Keep rating labels and keyboard shortcuts visible.
- Success announcements remain accessible to assistive technology and do not shift the page unexpectedly.
- Caught-up and unavailable states use learning-specific copy and a single return action.

### Settings

- Group existing information into four sections: connection health, data health, backup and recovery, and application details.
- Begin with a compact health overview using only existing values.
- Use rows for data that benefits from comparison; avoid turning every value into a card.
- Keep Drive links, quarantine records, export behavior, runtime/version, and PWA guidance unchanged.
- Destructive or recovery-adjacent actions remain visually distinct from routine navigation.

## Shared states and components

The redesign should centralize the following visual contracts without changing their behavioral interfaces:

- `PageHeader`: title, description, optional action group.
- `PageState`: screen-specific icon, title, optional description, and at most one primary action.
- `MediaFrame`: image, aspect ratio, caption, loading, and fallback behavior.
- `StatusRow`: compact label/value or navigation status.
- Existing `Button` variants: primary, secondary, quiet, and destructive.
- Form controls: label, supporting text, validation, disabled state, and focus state.

Components remain semantic HTML and preserve existing accessible names used by automated tests.

## Data and navigation flow

No data-flow changes are allowed.

1. Anonymous users access only `/view/*` and `/api/public/*`.
2. `Admin sign in` routes to `/login/`.
3. GitHub authentication and exact `aserdargun` owner verification protect private routes and APIs.
4. Owner capture, Drive synchronization, organization, review scheduling, favorites, and deletion continue through their existing components and endpoints.
5. Theme preference remains local UI state.

The redesign may reorganize markup and CSS but must not weaken route authorization or expose private metadata on public surfaces.

## Error handling

- Preserve current loading and API error semantics.
- Each screen displays errors close to the affected workflow.
- Retry remains available only where it already exists or can safely repeat an idempotent read.
- Form validation errors remain connected to their inputs.
- Destructive confirmation remains modal, keyboard reachable, and reversible only where the existing API supports it.

## Accessibility requirements

- Maintain logical heading order and landmark structure.
- All interactive elements have visible keyboard focus.
- Minimum target size is 44 by 44 CSS pixels for primary navigation and actions.
- Text and meaningful interface boundaries meet WCAG 2.2 AA contrast expectations.
- Color is never the only status signal.
- Mobile layouts have no horizontal content overflow at 390px.
- Content remains usable at 200% browser zoom.
- Images keep useful alternative text; decorative icons are hidden from assistive technology.
- Live review/save status uses the existing appropriate announcement semantics.

## Testing strategy

### Automated

- Update shell tests for the revised public, login, desktop, and mobile navigation structure.
- Preserve public-route and authentication assertions.
- Update capture and Inbox tests without weakening behavioral checks.
- Preserve Library detail, Review, Surprise, PWA, and destructive-action coverage.
- Add focused tests for new shared layout components and screen-specific empty states.
- Run type checking, linting, unit/component tests, production build, and the existing Playwright suite.

### Visual and interaction verification

- Verify public gallery, login, Today, Add, Inbox, Library, Review, Surprise, Settings, and both detail views in the in-app browser.
- Verify representative populated, loading, empty, and error states where fixtures permit.
- Capture desktop at 1440 by 1024 and mobile at 390 by 844.
- Compare the final implementation with the approved Editorial Learning Studio visual target for hierarchy, typography, palette, media treatment, spacing, controls, and responsive behavior.
- Confirm the core path: public gallery to login, owner Today to Add, capture to Inbox, Inbox to Library, Library to detail, and Review rating.

## Acceptance criteria

The redesign is complete when:

1. All existing routes and workflows remain functional.
2. Public, login, and owner surfaces share one recognizable visual system.
3. Desktop pages use the available viewport intentionally without over-dense filler.
4. Mobile navigation and primary actions remain fully visible and reachable.
5. Screen-specific empty states clearly communicate the next useful action.
6. Infographic media is visually dominant on public, library, detail, review, and surprise surfaces.
7. Authentication and public/private data boundaries are unchanged and regression tested.
8. Automated validation and production build pass.
9. Browser verification covers the core workflow at desktop and mobile sizes.
10. No custom-domain, DNS, certificate, storage-schema, or API-contract change is included.
