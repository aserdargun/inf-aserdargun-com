# INF Editorial Learning Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Editorial Learning Studio visual system to every INF public, login, and owner surface without changing authentication, data contracts, routes, or Google Drive behavior.

**Architecture:** Keep the existing Next.js routes and feature components, introduce a small shared `PageHeader` contract, extend `PageState` with screen-specific visual intent, and replace the compact global CSS with a token-driven responsive system. Behavioral components keep their current data fetching and mutations; tests assert preserved workflows plus the new structural and responsive contracts.

**Tech Stack:** Next.js 16, React 19, TypeScript 7, Tailwind CSS import with project CSS classes, Lucide React, Playwright, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-inf-editorial-learning-studio-redesign-design.md`

## Global Constraints

- Preserve GitHub exact-owner authentication and anonymous `/view/*` plus `/api/public/*` boundaries.
- Preserve every existing route, API contract, Google Drive operation, and data field.
- Do not add network fonts, AI, collaboration, public editing, custom-domain, DNS, or certificate changes.
- Keep existing visible product copy except the approved public-gallery return link and concise accessibility clarification.
- Use only the existing Lucide icon dependency and one consistent outline weight.
- Maintain 44 by 44 CSS-pixel primary targets, visible focus, reduced-motion support, 390px mobile support, and 200% zoom usability.
- Apply test-driven development: change a focused Playwright assertion first, observe failure, implement, then rerun the focused test.

---

### Task 1: Shared visual foundation and layout contracts

**Files:**
- Create: `components/ui/page-header.tsx`
- Modify: `components/ui/page-state.tsx`
- Modify: `components/app-shell.tsx`
- Modify: `app/globals.css`
- Test: `e2e/shell.spec.ts`

**Interfaces:**
- Produces: `PageHeader({ title, description, actions?, className? })` rendering a semantic header with `.page-header`, `.page-header__copy`, and `.page-header__actions`.
- Produces: `PageState` with optional `icon` and `className` props while retaining existing `action`, `description`, `kind`, and `title` props.
- Consumes: existing `AppShell`, `SidebarNav`, `MobileNav`, theme tokens, and `Button` classes.

- [ ] **Step 1: Add failing shell assertions for the approved tokens and shared geometry**

Add to `e2e/shell.spec.ts`:

```ts
test("uses the editorial design tokens and wide owner workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toHaveCSS("width", "248px");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 242, 234)");
  await expect(page.locator(".app-main")).toHaveCSS("margin-left", "248px");
  await expect(page.locator(".today-page > .page-header")).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails on the old shell**

Run: `pnpm e2e e2e/shell.spec.ts -g "editorial design tokens"`

Expected: FAIL because the sidebar is 216px, canvas is white, and `.page-header` does not exist.

- [ ] **Step 3: Implement the shared component interfaces**

Create `components/ui/page-header.tsx` with this public contract:

```tsx
import type { ReactNode } from "react";

interface PageHeaderProps {
  actions?: ReactNode;
  className?: string;
  description: string;
  title: string;
}

export function PageHeader({ actions, className = "", description, title }: PageHeaderProps) {
  return <header className={`page-header ${className}`.trim()}>
    <div className="page-header__copy"><h1>{title}</h1><p>{description}</p></div>
    {actions ? <div className="page-header__actions">{actions}</div> : null}
  </header>;
}
```

Extend `PageStateProps` with `icon?: typeof Inbox` and `className?: string`, select `icon ?? defaultIcon`, and merge the class without changing live-region behavior.

- [ ] **Step 4: Replace base tokens and shell geometry in `app/globals.css`**

Implement the exact light and dark token values from the spec, a 248px rail, a centered 1280px content container, shared page headers, 10px controls, 16px media/state radii, editorial type scale, 44px controls, and reduced-motion behavior. Keep CSS selectors used by existing behavioral tests.

- [ ] **Step 5: Run the focused shell test and all shell tests**

Run: `pnpm e2e e2e/shell.spec.ts`

Expected: PASS with existing auth/navigation/theme assertions intact.

- [ ] **Step 6: Commit the foundation**

```bash
git add components/ui/page-header.tsx components/ui/page-state.tsx components/app-shell.tsx app/globals.css e2e/shell.spec.ts
git commit -m "feat: establish editorial learning studio foundation"
```

### Task 2: Public gallery, public detail, and owner login

**Files:**
- Modify: `components/public-shell.tsx`
- Modify: `features/public-view/public-gallery.tsx`
- Modify: `features/public-view/public-detail.tsx`
- Modify: `app/login/page.tsx`
- Modify: `app/globals.css`
- Test: `e2e/public-view.spec.ts`
- Test: `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: current anonymous DTOs and `/api/public/*` URLs.
- Produces: a shared public brand shell and `/view/` return link from login.
- Preserves: `Admin sign in`, `Continue with GitHub`, all public accessible names, and all public API isolation assertions.

- [ ] **Step 1: Add failing public and login structure assertions**

Add assertions that `.public-content__heading` and `.public-grid` are visible for populated data, that public items retain `Open <title>` links, that `.login-page__intro` and `.login-panel` exist, and that login contains a link named `View public collection` with `href="/view/"`.

- [ ] **Step 2: Run the focused tests and observe the missing editorial structures**

Run: `pnpm e2e e2e/public-view.spec.ts e2e/shell.spec.ts -g "public|login"`

Expected: FAIL on `.login-page__intro`, `.login-panel`, and the public-return link.

- [ ] **Step 3: Restructure public and login markup without changing data behavior**

Use the existing public gallery/detail elements, add purely presentational wrappers as needed, and change login to:

```tsx
<main className="login-page">
  <section className="login-page__intro" aria-label="About INF">…</section>
  <section className="login-panel" aria-labelledby="login-title">…</section>
</main>
```

Keep the sign-in state machine and GitHub redirect intact. Add `<a className="login-public-link" href="/view/">View public collection</a>`.

- [ ] **Step 4: Implement the public editorial CSS**

Use a compact shared header, three/two/one-column media grid, 16:10 media frames, stronger caption hierarchy, media-first detail view, two-column desktop login, and single-column mobile login. Do not expose owner navigation or private metadata.

- [ ] **Step 5: Run public and shell suites**

Run: `pnpm e2e e2e/public-view.spec.ts e2e/shell.spec.ts`

Expected: PASS, including the assertion that every public request starts with `/api/public/`.

- [ ] **Step 6: Commit public and login redesign**

```bash
git add components/public-shell.tsx features/public-view/public-gallery.tsx features/public-view/public-detail.tsx app/login/page.tsx app/globals.css e2e/public-view.spec.ts e2e/shell.spec.ts
git commit -m "feat: redesign public gallery and owner login"
```

### Task 3: Authenticated shell and Today

**Files:**
- Modify: `components/sidebar-nav.tsx`
- Modify: `components/mobile-nav.tsx`
- Modify: `features/today/today-page.tsx`
- Modify: `app/globals.css`
- Test: `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `PageHeader`, existing routes, Today catalog/stat responses, `MediaFrame`, and `PageState`.
- Produces: shared owner header actions, editorial status strip, responsive Today media rail, and a screen-specific empty state.

- [ ] **Step 1: Add failing Today hierarchy and mobile safe-area assertions**

Assert that `Start review` and `Surprise me` are inside `.page-header__actions`, the empty state has `.today-empty`, and at 390x844 the bottom navigation is fixed while `.app-main` has bottom padding greater than its height.

- [ ] **Step 2: Run the focused Today assertions**

Run: `pnpm e2e e2e/shell.spec.ts -g "Today|safe-area"`

Expected: FAIL because actions are absolutely positioned and the empty state is generic.

- [ ] **Step 3: Adopt `PageHeader` in Today and refine navigation markup**

Move existing Today action links into the `actions` prop. Pass a Today-specific class and `Sparkles` icon to the empty `PageState`. Keep the same links, labels, Today API requests, status counts, and media ordering.

- [ ] **Step 4: Implement responsive Today and shell CSS**

Use a 248px desktop rail, clear current-route surface, aligned footer controls, 2-column header on desktop, stacked header on mobile, four-column media rail where space allows, and a safe-area-aware five-item mobile bar.

- [ ] **Step 5: Run shell tests and commit**

Run: `pnpm e2e e2e/shell.spec.ts`

```bash
git add components/sidebar-nav.tsx components/mobile-nav.tsx features/today/today-page.tsx app/globals.css e2e/shell.spec.ts
git commit -m "feat: modernize owner shell and Today"
```

### Task 4: Capture and Inbox workflow

**Files:**
- Modify: `features/capture/capture-form.tsx`
- Modify: `features/capture/capture-dropzone.tsx`
- Modify: `features/inbox/inbox-page.tsx`
- Modify: `features/inbox/inbox-row.tsx`
- Modify: `app/globals.css`
- Test: `e2e/capture-inbox.spec.ts`

**Interfaces:**
- Consumes: existing clipboard/file capture, POST `/api/infographics`, GET/PATCH owner catalog, and POST `/api/sync` behavior.
- Produces: `.capture-workspace`, `.capture-workspace__media`, `.capture-workspace__details`, and header-aligned Inbox sync.
- Preserves: every input label, error string, disabled state, and successful route transition.

- [ ] **Step 1: Add failing layout assertions around the existing capture workflow**

At 1440px assert `.capture-workspace` uses two grid columns and the preview/details regions are siblings. At 390px assert one column, no horizontal overflow, and every existing control remains at least 44px high.

- [ ] **Step 2: Run the focused capture layout test**

Run: `pnpm e2e e2e/capture-inbox.spec.ts -g "44px native picker|uploads without metadata"`

Expected: FAIL on the new workspace selectors before markup changes.

- [ ] **Step 3: Recompose CaptureForm and Inbox presentation**

Wrap dropzone plus preview in `.capture-workspace__media`; wrap optional fields, messages, and save action in `.capture-workspace__details`. Use `PageHeader` in Capture and Inbox, keeping `Sync Drive` in the Inbox header action area. Keep submit, deduplication, clipboard, drag/drop, and metadata mutation code unchanged.

- [ ] **Step 4: Implement responsive capture and Inbox CSS**

Use a minmax two-column capture grid, a paper-like media well, grouped fields, a content-sized save button, stronger Inbox thumbnail column, and one-column mobile collapse.

- [ ] **Step 5: Run the capture/Inbox suite and commit**

Run: `pnpm e2e e2e/capture-inbox.spec.ts`

```bash
git add features/capture/capture-form.tsx features/capture/capture-dropzone.tsx features/inbox/inbox-page.tsx features/inbox/inbox-row.tsx app/globals.css e2e/capture-inbox.spec.ts
git commit -m "feat: redesign capture and Inbox workflow"
```

### Task 5: Library, detail, Review, Surprise, and Settings

**Files:**
- Modify: `features/library/library-page.tsx`
- Modify: `features/library/library-grid.tsx`
- Modify: `features/library/infographic-tile.tsx`
- Modify: `features/detail/infographic-detail.tsx`
- Modify: `features/review/review-page.tsx`
- Modify: `features/surprise/surprise-page.tsx`
- Modify: `features/settings/settings-page.tsx`
- Modify: `app/globals.css`
- Test: `e2e/library-detail.spec.ts`
- Test: `e2e/learning.spec.ts`

**Interfaces:**
- Consumes: existing Library URL filters, detail mutations, review queue/ratings, surprise selection, settings health, quarantine, and export data.
- Produces: shared page headers, media-dominant learning/detail layouts, compact Library toolbar, and grouped Settings sections.
- Preserves: all accessible labels, query serialization, mutation order, rating shortcuts, announcements, and export behavior.

- [ ] **Step 1: Add failing structural assertions for each owner surface**

Assert `.library-page > .page-header`, `.detail-layout`, `.learning-stage`, and `.settings-overview` are visible in their populated fixtures; preserve every current role/name assertion.

- [ ] **Step 2: Run focused suites and confirm only new structure fails**

Run: `pnpm e2e e2e/library-detail.spec.ts e2e/learning.spec.ts`

Expected: FAIL on new shared structural selectors while existing behavior remains green.

- [ ] **Step 3: Recompose markup with shared headers and semantic groups**

Adopt `PageHeader` without changing data hooks. Add `.learning-stage` around the existing media and controls. Add `.settings-overview` using the already-fetched connection/data values, followed by the existing detailed rows grouped into connection health, data health, backup and recovery, and application details.

- [ ] **Step 4: Implement Library, detail, learning, and Settings CSS**

Use a compact filter toolbar, responsive media grid, dominant detail image, constrained learning width, large contained review image, readable rating controls, and a Settings overview plus lightweight row groups. Avoid nested cards and invented metrics.

- [ ] **Step 5: Run the Library and learning suites and commit**

Run: `pnpm e2e e2e/library-detail.spec.ts e2e/learning.spec.ts`

```bash
git add features/library features/detail features/review features/surprise features/settings app/globals.css e2e/library-detail.spec.ts e2e/learning.spec.ts
git commit -m "feat: redesign library learning and settings surfaces"
```

### Task 6: Full responsive, accessibility, and production verification

**Files:**
- Modify: `app/globals.css`
- Modify: `components/app-shell.tsx`
- Modify: `components/public-shell.tsx`
- Modify: `features/today/today-page.tsx`
- Modify: `features/capture/capture-form.tsx`
- Modify: `features/inbox/inbox-page.tsx`
- Modify: `features/library/library-page.tsx`
- Modify: `features/review/review-page.tsx`
- Modify: `features/surprise/surprise-page.tsx`
- Modify: `features/settings/settings-page.tsx`
- Modify: `e2e/shell.spec.ts`
- Modify: `e2e/public-view.spec.ts`
- Modify: `e2e/capture-inbox.spec.ts`
- Modify: `e2e/library-detail.spec.ts`
- Modify: `e2e/learning.spec.ts`
- Create: `docs/design/EDITORIAL_FIDELITY_LEDGER.md`

**Interfaces:**
- Consumes: the accepted design spec, all implemented surfaces, and existing local lifecycle scripts.
- Produces: a clean production artifact, a written fidelity ledger, and current desktop/mobile browser evidence.

- [ ] **Step 1: Run static and focused validation**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm web:build && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 2: Run the complete end-to-end suite**

Run: `pnpm e2e`

Expected: all Playwright tests pass without weakened auth, public-boundary, capture, Library, review, Settings, or PWA assertions.

- [ ] **Step 3: Start the complete local stack and verify with the in-app browser**

Run: `pnpm dev:codex`

Verify public gallery, login, Today, Add, Inbox, Library, detail, Review, Surprise, and Settings at 1440x1024; repeat public gallery, Today, Add, Library, and Settings at 390x844.

- [ ] **Step 4: Capture and compare visual evidence**

Save accepted-spec and final-render evidence references in `docs/design/EDITORIAL_FIDELITY_LEDGER.md`. Record at least five comparisons covering hierarchy, palette, typography, media framing, container spacing, controls, and responsive behavior. Fix every material mismatch that is possible within the approved scope.

- [ ] **Step 5: Verify the core interaction path**

Confirm public gallery to login; Today to Add; file capture to Inbox; Inbox organization to Library; Library to detail; Review rating and advance; Settings health and export. Confirm no private API request occurs in public mode.

- [ ] **Step 6: Stop local services and verify checkout ownership cleanup**

Run: `pnpm stop:codex`

Verify ports 4280, 7071, and 7072 have no checkout-owned listeners.

- [ ] **Step 7: Run final validation and commit evidence**

Run: `pnpm validate:codex && git diff --check`

```bash
git add app components features e2e docs/design/EDITORIAL_FIDELITY_LEDGER.md
git commit -m "test: verify editorial learning studio redesign"
```
