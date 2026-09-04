# Editorial Learning Studio fidelity ledger

## Visual target and method

The 2026-08-23 editorial target remains the visual origin for the warm canvas,
quiet surfaces, strong Today hierarchy, media-first composition, and restrained
blue/green emphasis. Evolutionary 2.0 intentionally extends that target across
every route and adds a dedicated tablet mode. Validation uses rendered local
pages, deterministic safe fixtures, automated route checks, and the in-app
browser at desktop, tablet, and mobile sizes.

## Retained fidelity

| Area | Retained contract |
| --- | --- |
| Product identity | `Infographics` wordmark; `INF` only for icon-sized identity |
| Palette | Warm canvas, near-white surfaces, blue action, restrained success color |
| Hierarchy | Infographic media remains dominant; application chrome recedes |
| Controls | Visible labels, 44px minimum primary targets, two-pixel focus |
| Responsive continuity | Desktop rail and labelled five-item bottom navigation |
| Public boundary | Public view exposes view-only DTO data and Admin sign in, never owner controls |

## Intentional Evolutionary 2.0 deviations

- Tablet now uses a persistent top brand bar plus floating bottom navigation;
  the earlier target had only a desktop/mobile split.
- Empty and error states are bounded editorial compositions rather than
  full-width boxes.
- Add compacts the capture surface after image selection so preview, optional
  details, and Save to Inbox move closer to the first viewport.
- Inbox metadata editors use disclosure on mobile while the title and organize
  state remain visible.
- Library keeps search visible and moves secondary filters into an accessible
  native modal panel on tablet and mobile.
- Settings exposes Appearance and follows the approved operational order:
  Appearance, Connection health, Data health, Backup and recovery, Application
  details.

These deviations are presentation-only. Existing routes, API contracts,
authentication, storage, caching, public projection, and workflow semantics are
unchanged.

## Verification

The accessibility matrix verifies 390×844, 820×1180, and 1024×768 for overflow,
44px targets, and fixed-navigation focus safety. The exact 768px shell boundary
is executable coverage: 768px uses tablet navigation and 767px uses the attached
mobile bar. Deterministic owner/public evidence is captured from real rendered
local pages at exact desktop and mobile dimensions.
