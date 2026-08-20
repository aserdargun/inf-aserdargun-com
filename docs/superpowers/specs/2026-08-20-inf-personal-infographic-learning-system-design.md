# INF Personal Infographic Learning System Design

Date: 2026-08-20

## 1. Purpose

INF is a personal, image-first learning system for collecting infographics,
organizing them, resurfacing forgotten material, and strengthening recall. Its
core loop is:

> Capture → Organize → Resurface → Recall → Learn

INF is not a generic bookmark manager, social feed, or image gallery. The
owner application rewards review and recall rather than accumulation. A
separate public View Mode makes the owner's intentionally public infographic
collection observable without exposing private learning data.

The application contains no AI functionality or AI-facing abstractions. It
does not use LLM APIs, embeddings, vector databases, semantic search, OCR,
generated classifications, generated summaries, or generated questions.

## 2. Accepted Scope Changes

The original SQLite, Drizzle, local `/data`, Docker, and Caddy architecture is
superseded by the approved low-cost hosting design:

- Next.js App Router is statically exported to Azure Static Web Apps.
- HTTP APIs run as managed Azure Functions inside Static Web Apps.
- Google Drive is the persistent content and event store.
- Public infographic assets and private learning records live in separate
  Drive folders.
- Azure Static Web Apps uses the Free plan in West Europe.
- GitHub authentication follows the Stackfolio owner model.

SQLite cannot be safely opened from Google Drive object storage, and Static
Web Apps has no persistent local filesystem. Consequently, SQLite and Drizzle
are deliberately removed rather than emulated through unsafe download-edit-
upload cycles.

## 3. Users and Surfaces

INF has two surfaces.

### 3.1 Owner application

The owner application is private and single-user. Azure Static Web Apps
requires GitHub authentication, and every private API independently verifies
that the authenticated GitHub username matches `INF_ALLOWED_GITHUB_USER`.

Owner routes:

- `/`
- `/add`
- `/inbox`
- `/library`
- `/infographic/[id]`
- `/surprise`
- `/review`
- `/settings`

### 3.2 Public View Mode

Public View Mode is anonymous, read-only, image-focused, and intentionally
minimal.

Public routes:

- `/view`
- `/view/[id]`

The public projection may contain only:

- infographic identifier;
- public image and thumbnail;
- public-safe display title;
- capture or publication date.

It must never expose notes, source URLs, source authors, review history,
ratings, due dates, seen counts, favorites, private categories or tags,
learning statistics, OAuth credentials, Drive credentials, or private event
records.

## 4. Technology

- Next.js App Router with static export
- TypeScript in strict mode
- Tailwind CSS
- Zod
- Sharp in the managed API for image decoding and thumbnails
- pnpm with a committed lockfile and pinned package-manager declaration
- Azure Functions Node.js programming model v4
- Google Drive API v3
- Vitest
- Playwright

Latest stable, mutually compatible versions are selected during
implementation and verified against Azure Static Web Apps managed runtime
support. No PostgreSQL, Redis, object-storage service, queue, microservice,
analytics service, remote font, or external image transformer is introduced.

## 5. Architecture

```text
Anonymous browser
  → Azure Static Web Apps `/view*`
  → `/api/public/*`
  → approved public Drive folder projection

Owner browser
  → Azure Static Web Apps GitHub authentication
  → statically exported Next.js application
  → owner-verified `/api/*`
  → public image Drive folder + private event Drive folder
```

The static frontend contains no Google credentials. All Drive access happens
inside managed Azure Functions. Public Functions are read-only and constrained
to the configured public folder. Private Functions verify both Azure's client
principal and the exact owner username before accessing private data or
performing mutations.

Unknown dynamic identifiers are handled without a Next.js server. Static Web
Apps rewrites `/infographic/*` and `/view/*` to static viewer shells while
preserving the browser URL. The client shell reads the path identifier and
loads data through the appropriate API projection.

## 6. Google Drive Layout

### 6.1 Public infographic folder

The approved public root is:

- Name: `INF-ASERDARGUN-COM`
- Folder ID: `1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK`
- URL: `https://drive.google.com/drive/folders/1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK`

INF creates these children:

```text
INF-ASERDARGUN-COM/
├── Inbox/
├── Library/
├── Archive/
├── Duplicates/
└── Thumbnails/
```

The owner can add images directly to `Inbox` through Google Drive. INF's
`/add` flow writes to the same folder. A Drive sync operation discovers new
files and materializes them into the private learning catalog.

Public behavior by folder:

- `Inbox`: visible in View Mode and owner Inbox.
- `Library`: visible in View Mode and owner Library.
- `Archive`: still observable in View Mode but absent from the active owner
  library.
- `Duplicates`: not displayed by INF; files remain recoverable and visible to
  the owner in Drive.
- `Thumbnails`: public derivatives used by View Mode and the owner grid.

Deleting an infographic moves its original and thumbnail to Drive Trash. It
does not permanently delete them.

### 6.2 Private learning-data folder

INF provisions a separate, restricted sibling folder named
`INF-PRIVATE-DATA`. It is not placed under the public root because Drive folder
permissions propagate to descendants. Its resulting folder ID is stored only
as `INF_PRIVATE_DRIVE_FOLDER_ID` in the local secret environment and Azure
Static Web Apps application settings.

```text
INF-PRIVATE-DATA/
├── events/
├── reviews/
├── quarantine/
└── exports/
```

No private learning data is written under the public folder.

## 7. Drive Authentication

The deployed API uses a one-time owner-authorized Google OAuth grant. Because
the owner may manually create files in the watched folder outside INF, the
server requires a Drive scope that can list and read those files. Application
code restricts all operations to the two configured folder roots and their
verified descendants.

These values are secrets and never enter the repository or client bundle:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `INF_PRIVATE_DRIVE_FOLDER_ID`

The public folder ID is not secret. Google credentials are stored in ignored
local settings for development and Azure Static Web Apps application settings
for production.

## 8. Event Model

Private learning state is stored as immutable, schema-versioned JSON events.
The source of truth is the event collection; any generated catalog snapshot is
only a rebuildable cache.

Core event types:

- `infographic.created`
- `infographic.metadataUpdated`
- `infographic.categoriesAssigned`
- `infographic.tagsAssigned`
- `infographic.favoriteChanged`
- `infographic.archived`
- `infographic.deleted`
- `infographic.seen`
- `review.recorded`
- `sync.fileRejected`

Each event contains:

- UUID event ID;
- schema version;
- event type;
- infographic ID where applicable;
- UTC occurrence time;
- validated event payload.

Events are folded by `(occurredAt, eventId)` to guarantee deterministic state
when two operations have the same timestamp. Unknown schema versions and
invalid events are excluded from the materialized catalog and reported in the
quarantine view rather than crashing the entire library.

### 8.1 Infographic state

The materialized infographic includes:

- UUID ID
- public-safe title
- private notes
- private source URL, platform, and author
- original and thumbnail Drive file IDs
- SHA-256
- favorite and archived state
- created, captured, and last-seen timestamps
- seen count
- category and tag IDs
- Drive folder state

Categories and tags have UUIDs, normalized names, and slugs. Assignments are
explicit in event payloads and are derived into join-like materialized views.

### 8.2 Reviews

Every review answer is an immutable event with:

- UUID review ID;
- infographic ID;
- rating: `again`, `hard`, `good`, or `easy`;
- reviewed timestamp;
- previous interval;
- calculated next interval;
- calculated due timestamp.

Persisting the calculated result prevents later algorithm changes from
rewriting history.

## 9. Capture and Drive Sync

### 9.1 App capture

`/add` supports clipboard paste, screenshot paste, drag and drop, and a file
picker. Image preview appears immediately; metadata is optional.

The capture API:

1. verifies the owner principal;
2. validates multipart size and MIME declaration;
3. decodes the image with Sharp and applies a pixel-count limit;
4. calculates SHA-256;
5. searches Drive custom `appProperties` for the hash;
6. stores the original unchanged in public `Inbox`;
7. creates an optimized WebP thumbnail;
8. writes the private creation event;
9. returns the new Inbox item.

The request limit is 20 MB to remain below the Static Web Apps 30 MB request
limit after multipart overhead. Pixel dimensions are bounded independently to
prevent decompression bombs.

### 9.2 Manual Drive capture

The owner can put an image directly into public `Inbox`. `Sync Drive`, owner
application startup, and a post-capture refresh may trigger a bounded sync.
There is no background timer or non-HTTP Function trigger in the MVP.

For every untracked file, sync performs the same validation, hash, duplicate,
thumbnail, and creation-event steps. Originals are never recompressed or
silently destroyed. Duplicate files move to `Duplicates`; rejected files stay
recoverable and produce a quarantine record.

### 9.3 Transaction compensation

Drive and event writes are not a distributed transaction. Each operation
tracks only the files it created. If a later step fails, it trashes those new
derivatives and records a bounded diagnostic. It never deletes a pre-existing
owner file. Retriable Drive `429` and transient `5xx` responses use bounded
exponential backoff.

## 10. Screens

### `/`

Shows Inbox count, active Library count, due-review state, recently added
items, one prominent `Surprise me` action, and one prominent `Start review`
action. It is not an analytics dashboard.

### `/add`

Optimized for low-friction paste, drop, and selection. Metadata fields for
source URL, source platform, title, and notes are optional.

### `/inbox`

Shows captured, not-yet-organized infographics. Inline actions edit title,
assign the first category, assign tags, favorite, or archive. The first
category assignment marks the item processed and moves the original from
Drive `Inbox` to `Library`.

### `/library`

An adaptive image-first grid for processed, non-archived items. It filters by
category, tag, favorite, source, recently added, and least recently seen.
Deterministic normalized text search covers title, notes, tags, categories,
source author, and source URL.

### `/infographic/[id]`

Shows the owner-authorized large image, metadata, categories, tags, source,
capture date, review history, seen count, and favorite state. It supports edit,
archive, favorite, review, and confirmed delete actions.

### `/surprise`

Selects one active infographic through the isolated weighted strategy. An item
is marked seen only when intentionally selected here or presented in Review;
thumbnail rendering does not update seen state.

### `/review`

Displays one due infographic prominently, asks “Do you remember the main idea
of this infographic?”, records Again/Hard/Good/Easy, and advances to the next
due item.

### `/settings`

Shows application information, public/private Drive connection health, data
statistics, quarantine diagnostics, export and backup guidance, and PWA
installation information.

### `/view` and `/view/[id]`

Provide an anonymous, read-only public gallery and large image view. They do
not contain owner navigation, write controls, private metadata, or login
prompts.

## 11. Surprise Selection

For each eligible active item:

```text
age = neverSeen
  ? max(14, daysSinceCapture + 7)
  : max(1, daysSinceLastSeen)

weight = age × neverSeenBoost
  / ((1 + seenCount) × (1 + reviewCount × 0.5))
```

`neverSeenBoost` is `2` for never-seen items and `1` otherwise. A seeded PRNG
uses the UTC date, owner identity, and persisted surprise counter. Identical
catalog and seed inputs return the same selection. Tests document the formula
and edge cases.

## 12. Review Scheduling

First-review intervals:

- Again: 1 day
- Hard: 3 days
- Good: 7 days
- Easy: 14 days

Subsequent intervals:

- Again: 1 day
- Hard: `max(2, round(previous × 1.2))`
- Good: `max(4, round(previous × 2))`
- Easy: `max(7, round(previous × 3))`

The scheduler is a small pure module and is intentionally not SM-2. Due items
sort by due time, then least recently reviewed, then infographic ID for a
stable tie-breaker.

## 13. API Boundary

Public read-only endpoints:

- `GET /api/public/infographics`
- `GET /api/public/infographics/{id}`
- `GET /api/public/images/{driveFileId}`

Owner endpoints:

- `GET /api/session`
- `POST /api/sync`
- `GET /api/infographics`
- `POST /api/infographics`
- `GET /api/infographics/{id}`
- `PATCH /api/infographics/{id}`
- `DELETE /api/infographics/{id}`
- `POST /api/infographics/{id}/seen`
- `POST /api/infographics/{id}/reviews`
- `GET /api/surprise`
- `GET /api/review`
- `GET /api/settings/stats`

All payloads use shared Zod schemas. Public serializers construct an explicit
allowlisted projection instead of removing private keys from owner objects.
Image endpoints verify that the requested file is a descendant of the
configured public root before reading it.

## 14. Authentication and Security

`staticwebapp.config.json` permits anonymous access only to:

- `/view*`;
- `/api/public/*`;
- `/login` and sign-in support assets;
- manifest, icons, service worker, and required static assets.

All other routes require `authenticated`. The API still performs the exact
GitHub owner check because the built-in `authenticated` role alone permits any
signed-in GitHub account.

Local auth bypass requires all of:

- an explicit local bypass environment flag;
- a loopback request host;
- absence of the Azure production environment signal;
- a private local proxy token for proxied API calls.

Security headers include a same-origin Content Security Policy, no-referrer,
nosniff, frame denial, and appropriate private/public cache directives. Source
URLs are never fetched automatically. There are no analytics, trackers,
telemetry, remote fonts, or third-party content embeds.

## 15. PWA and Offline Behavior

INF includes a manifest, install icons, standalone display mode, theme
metadata, and a service worker foundation. The service worker caches the
application shell and bounded last-read catalog data. The server remains the
source of truth. Offline writes, conflict queues, and background sync are not
part of the MVP.

## 16. Visual Direction

The UI is a calm personal visual notebook: Apple Settings × Linear, with
neutral surfaces, precise typography, restrained borders, and images supplying
most color. It supports excellent light and dark themes.

Desktop uses a narrow sidebar; mobile uses a bottom navigation bar. The design
avoids marketing layouts, giant rounded cards, excessive shadows, gradients,
badges, dashboards, and decorative animation. Motion is limited and respects
`prefers-reduced-motion`.

A complete primary-screen and mobile visual concept is generated and approved
before implementation. The implementation is compared against that accepted
concept in desktop and mobile browser QA.

## 17. Testing

### 17.1 Unit and integration tests

Vitest covers:

- image MIME, byte-size, decode, and pixel validation;
- duplicate SHA detection;
- infographic creation and deterministic event folding;
- category and tag assignment;
- deterministic normalized search;
- weighted selection and seeded determinism;
- intentional seen updates;
- review creation and scheduling;
- owner authentication and local bypass boundaries;
- public serializer field allowlist;
- descendant-folder enforcement for public images;
- invalid-event quarantine;
- upload compensation and bounded retry behavior;
- public/private visibility effects for categorize, archive, and delete.

API integration tests use a temporary local event-store adapter. A dedicated
Drive test area validates actual create, read, property search, move, and trash
behavior before production publication.

### 17.2 Browser tests

Playwright verifies an anonymous View Mode flow and the owner flow:

1. open the application through local bypass;
2. paste or upload an infographic;
3. find it in Inbox;
4. assign a category and tag;
5. open Library and search;
6. open the infographic and favorite it;
7. run Surprise;
8. answer a Review rating;
9. reload and verify persisted review state;
10. confirm the public item in View Mode;
11. prove anonymous private routes and APIs are rejected.

Desktop and mobile viewports, keyboard navigation, overflow, browser console,
PWA manifest, service worker registration, and accessibility-critical labels
are included in release validation.

## 18. Local Development Contract

The repository defines reproducible Codex and terminal actions:

- Setup: frozen pnpm install plus required local browser/runtime tooling.
- Run: checkout-scoped local frontend, Functions, and Static Web Apps emulator
  on deterministic loopback ports.
- Validate: formatting/diff checks, lint, strict typecheck, unit/integration
  tests, production static build, artifact verification, and Playwright.
- Stop: idempotently terminates only listeners proven to belong to this
  checkout and refuses foreign processes.

Tests cover both owned-listener termination and foreign-listener refusal. No
development server remains running after final validation.

## 19. Documentation

Implementation produces:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT.md`
- `docs/INGESTION.md`
- `docs/ROADMAP.md`

The ingestion document reserves a future authenticated `POST /api/ingest`
contract for Apple Shortcuts, Android share targets, browser extensions, and
bookmarklets. The endpoint is not exposed unauthenticated in the MVP.

The roadmap documents manual recall prompts, deterministic SM-2-style future
scheduling, learning statistics, and gamification. Gamification rewards review
and recall, never content hoarding.

## 20. Backup and Portability

A complete backup consists of both Drive roots:

- the public infographic hierarchy;
- the private immutable event hierarchy.

The export foundation produces standard image files and JSON, not proprietary
database dumps. A restored installation can rebuild all materialized state by
folding the private events and correlating Drive file IDs and SHA-256 values.

## 21. GitHub and Azure Publication

After local completion and verification:

- GitHub owner: `aserdargun`
- Repository: `inf-aserdargun-com`
- Visibility: public
- Production branch: `main`
- Azure subscription: `aserdargun subscription`
- Region: West Europe
- SKU: Free
- Resource group: `rg-inf-aserdargun-com`
- Static Web App: `swa-inf-aserdargun-com`
- Static artifact: `out/`
- Managed API source: `api/`

The production workflow validates, builds, verifies, and deploys one correlated
commit. Completion requires local checks, remote commit correlation, a
successful GitHub workflow, Azure `Ready`, generated-host HTTP and asset
checks, owner/public browser flows, and production-targeted E2E where the auth
environment permits it.

Publication stops after the Azure-generated `*.azurestaticapps.net` hostname is
verified. The custom-domain list must remain empty. No `inf.aserdargun.com`
binding, IHS record, TXT, CNAME, certificate, forwarding, or other DNS change
is authorized in this milestone.

## 22. MVP Definition of Done

The milestone is complete when fresh evidence proves that the owner can:

1. run INF locally;
2. paste an infographic in `/add` or add it to Drive `Inbox`;
3. sync and find it in owner Inbox;
4. categorize and tag it;
5. find and search it in Library;
6. favorite and open it;
7. receive a weighted resurfaced infographic;
8. review it with Again, Hard, Good, or Easy;
9. reload and see persisted learning state;
10. observe the image anonymously in View Mode without private metadata;
11. install the PWA;
12. export or copy both Drive roots for recovery;
13. access the verified Azure-generated production URL.

No AI dependency, custom-domain operation, hidden public-data leak, unfinished
placeholder flow, or unverified deployment is accepted as complete.
