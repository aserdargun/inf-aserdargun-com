# INF MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, locally verify, publish, and Azure-deploy the approved INF owner learning application plus anonymous public View Mode, backed by the designated public Google Drive infographic folder and a separate private Drive event folder.

**Architecture:** A statically exported Next.js App Router frontend runs on Azure Static Web Apps Free. Managed Node.js 22 Azure Functions own authentication, image processing, Google Drive synchronization, immutable private events, and explicit public projections. A pnpm workspace shares Zod contracts and pure deterministic domain modules while keeping Azure and Drive adapters at the API boundary.

**Tech Stack:** Node.js 22, pnpm 11.22.0, Next.js 16.3.1, React 19.2.8, TypeScript 7.0.2, Tailwind CSS 4.3.3, Zod 4.4.3, Sharp 0.35.3, Azure Functions 4.16.2, Google APIs 176.0.0, Vitest 4.1.11, Playwright 1.62.1, Azure Static Web Apps CLI 2.0.10.

**Spec:** `docs/superpowers/specs/2026-08-20-inf-personal-infographic-learning-system-design.md`

## Global Constraints

- Keep INF completely AI-independent: no model APIs, embeddings, vector search, OCR, generated metadata, or future-AI abstractions.
- The UI language is English and the visual direction is calm, image-first, light/dark, Apple Settings × Linear, without marketing-page chrome.
- Public Drive root is exactly `1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK`; public/private Drive folder boundaries must never be inferred from names alone.
- Anonymous access is limited to `/view*`, `/api/public/*`, login support, PWA files, and required static assets.
- Every private API must independently match the GitHub principal to `INF_ALLOWED_GITHUB_USER=aserdargun`.
- Originals remain unchanged; thumbnails are WebP; uploads are at most 20 MB and have a separate decoded-pixel limit.
- Public serializers are allowlists. Never construct a public response by deleting keys from a private object.
- Private learning state is immutable, schema-versioned JSON events; SQLite and Drizzle are intentionally absent.
- Owner deletion moves Drive files to Trash; it never permanently deletes them.
- Use TDD for behavior: write the test, observe the expected failure, implement the minimum, observe green, then refactor.
- Use Node.js 22 because Azure Static Web Apps currently supports `apiRuntime: node:22`.
- Use the committed pnpm lockfile and exact package-manager declaration.
- Do not deploy until the complete local release contract and live Drive integration pass.
- Publish only to public `aserdargun/inf-aserdargun-com`, branch `main`, West Europe Free resources `rg-inf-aserdargun-com` and `swa-inf-aserdargun-com`.
- Stop after verifying the Azure-generated hostname and an empty custom-domain list. Do not touch IHS, DNS, `inf.aserdargun.com`, or certificates.

---

## File and Module Map

```text
app/                         Static Next.js routes and route shells
components/                  Shared presentational UI primitives
features/                    Owner/public feature components and hooks
lib/                         Browser API client, theme, formatting
public/                      SWA config, manifest, service worker, icons
packages/contracts/          Shared Zod DTO and event schemas
packages/domain/             Pure fold/search/surprise/review modules
api/src/auth/                Azure principal and local bypass authorization
api/src/functions/           Azure Functions v4 registrations
api/src/http/                Request parsing, response mapping, error mapping
api/src/images/              Validation, SHA-256, Sharp thumbnail pipeline
api/src/storage/             StoragePort, local adapter, Google Drive adapter
api/src/services/            Sync, catalog, capture, review application services
api/test/                    API integration and adapter contract tests
e2e/                         Owner and public Playwright flows
scripts/                     Local lifecycle, artifact, OAuth, and deployment helpers
tools/                       Environment/config/safe-stop contract tests
docs/design/                 Accepted visual concepts and fidelity ledger
docs/                        Architecture/product/ingestion/roadmap documentation
```

The API owns mutations. `packages/domain` cannot import React, Azure, Google,
filesystem, or clock globals. `packages/contracts` cannot import API or UI
code. Frontend features depend only on contracts and `lib/api-client.ts`.

---

### Task 1: Establish the reproducible workspace and static-host contract

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `pnpm-lock.yaml`
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`
- Create: `public/staticwebapp.config.json`
- Create: `public/manifest.webmanifest`
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/host.json`
- Create: `api/src/index.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `tools/project-contract.test.ts`
- Create: `scripts/verify-artifacts.mjs`

**Interfaces:**
- Consumes: Approved spec and exact tool versions in this plan.
- Produces: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm api:build`, and verified `out/` plus `api-dist/` artifacts.

- [ ] **Step 1: Create the root package manifest and workspace declarations**

Use this script contract in `package.json`:

```json
{
  "name": "inf-aserdargun-com",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@11.22.0",
  "engines": { "node": ">=22.0.0 <23" },
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port 3000",
    "build": "next build",
    "api:build": "pnpm --filter @inf/api build && pnpm --filter @inf/api deploy --prod api-dist",
    "artifact:verify": "node scripts/verify-artifacts.mjs",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit && pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "validate": "pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm api:build && pnpm artifact:verify && git diff --check"
  }
}
```

Declare workspace packages as `api` and `packages/*`. Pin the versions listed
in the plan header rather than using floating `latest` ranges.

- [ ] **Step 2: Install the exact dependency set and generate the lockfile**

Run:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install
```

Expected: `pnpm-lock.yaml` exists and `pnpm --version` prints `11.22.0`.

- [ ] **Step 3: Write the failing project-contract test**

`tools/project-contract.test.ts` must first assert the absent configuration:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("project contract", () => {
  test("exports Next statically and selects Node 22 for managed APIs", () => {
    const nextConfig = readFileSync("next.config.ts", "utf8");
    const swa = JSON.parse(readFileSync("public/staticwebapp.config.json", "utf8"));
    expect(nextConfig).toContain('output: "export"');
    expect(swa.platform.apiRuntime).toBe("node:22");
  });

  test("keeps public routes before the authenticated catch-all", () => {
    const swa = JSON.parse(readFileSync("public/staticwebapp.config.json", "utf8"));
    const publicIndex = swa.routes.findIndex((route: { route: string }) => route.route === "/view*");
    const privateIndex = swa.routes.findIndex((route: { route: string }) => route.route === "/*");
    expect(publicIndex).toBeGreaterThanOrEqual(0);
    expect(privateIndex).toBeGreaterThan(publicIndex);
  });
});
```

- [ ] **Step 4: Run the project-contract test and observe RED**

Run: `pnpm vitest run tools/project-contract.test.ts`

Expected: FAIL because `next.config.ts` or `staticwebapp.config.json` is absent.

- [ ] **Step 5: Add the minimal static Next, API, and SWA configuration**

`next.config.ts` must contain:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
```

`public/staticwebapp.config.json` must declare public assets and `/view*`
before private routes, rewrite `/view/*` to `/view/index.html`, rewrite
`/infographic/*` to `/infographic/index.html`, block AAD login, select
`node:22`, and redirect 401 to `/login`.

- [ ] **Step 6: Add a minimal branded shell and artifact verifier**

`app/page.tsx` returns a semantic `<main><h1>INF</h1></main>`. The artifact
verifier must exit nonzero unless all of these exist:

```js
const required = [
  "out/index.html",
  "out/staticwebapp.config.json",
  "out/manifest.webmanifest",
  "api-dist/host.json",
  "api-dist/package.json",
];
```

- [ ] **Step 7: Run contract, type, build, and artifact checks**

Run:

```bash
pnpm vitest run tools/project-contract.test.ts
pnpm typecheck
pnpm build
pnpm api:build
pnpm artifact:verify
```

Expected: all commands exit 0; `out/` and `api-dist/` are generated and ignored.

- [ ] **Step 8: Commit the workspace foundation**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .nvmrc .gitignore tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts playwright.config.ts app public api packages tools scripts/verify-artifacts.mjs
git commit -m "chore: establish INF workspace"
```

---

### Task 2: Produce and approve the complete visual concept

**Files:**
- Create: `docs/design/inf-owner-desktop.png`
- Create: `docs/design/inf-owner-mobile.png`
- Create: `docs/design/inf-public-view.png`
- Create: `docs/design/DESIGN_SYSTEM.md`

**Interfaces:**
- Consumes: Screen inventory, navigation labels, and visual constraints from the approved spec.
- Produces: Accepted concept paths, exact visible-copy inventory, tokens, typography, component families, responsive rules, and icon inventory used by Tasks 9-13.

- [ ] **Step 1: Invoke `build-web-apps:frontend-app-builder` and read `imagegen`**

Use the visual skill because this is a new app UI. Do not write UI production
code in this task.

- [ ] **Step 2: Generate the desktop owner concept**

The Image Gen prompt must name the actual Today dashboard, narrow sidebar,
Inbox/Library/Add/Review navigation, recent image rail, Surprise and Start
review actions, restrained neutral light theme, and the prohibition on
marketing heroes, decorative pills, gradients, and card grids.

- [ ] **Step 3: Generate the mobile owner and public View concepts**

The mobile concept must show bottom navigation and clipboard-first Add. The
public concept must be anonymous, image-first, read-only, and contain no owner
controls or private metadata.

- [ ] **Step 4: Present the three concepts and obtain explicit visual approval**

Pause implementation until the user accepts or requests revisions. Regenerate
unclear, cropped, or unreadable states rather than guessing.

- [ ] **Step 5: Extract the implementation inventory**

Write `DESIGN_SYSTEM.md` with:

```markdown
- Accepted concept paths and native dimensions
- Allowed visible copy per route
- Background, surface, text, border, accent, semantic colors
- UI and content typography sizes, weights, and line heights
- 4/8-based spacing scale and container widths
- Sidebar and bottom-nav dimensions
- Button, field, media-frame, row, empty-state, and dialog variants
- Lucide icon names, sizes, and stroke treatment
- Desktop/mobile breakpoints and overflow behavior
- Reduced-motion behavior
```

- [ ] **Step 6: Commit only accepted visual artifacts and inventory**

```bash
git add docs/design
git commit -m "docs: define INF visual system"
```

---

### Task 3: Define shared contracts and immutable event folding

**Files:**
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/entities.ts`
- Create: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/fold-events.ts`
- Create: `packages/domain/test/fold-events.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: Zod 4.4.3 and UUID/UTC data from adapters.
- Produces: `InfEventSchema`, `MaterializedCatalog`, and `foldEvents(events): FoldResult`.

- [ ] **Step 1: Write failing schema and fold tests**

```ts
import { describe, expect, test } from "vitest";
import { foldEvents } from "../src/fold-events";

test("creates an inbox infographic and applies ordered metadata events", () => {
  const result = foldEvents([
    event("infographic.metadataUpdated", "2026-08-20T10:00:01.000Z", { title: "CUDA memory" }),
    event("infographic.created", "2026-08-20T10:00:00.000Z", createdPayload()),
  ]);
  expect(result.catalog.infographics[0]).toMatchObject({ title: "CUDA memory", processedAt: null });
});

test("quarantines an unknown schema version without dropping valid records", () => {
  const result = foldEvents([validCreatedEvent(), { ...validCreatedEvent(), schemaVersion: 99 }]);
  expect(result.catalog.infographics).toHaveLength(1);
  expect(result.quarantine).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests and observe RED**

Run: `pnpm --filter @inf/domain vitest run test/fold-events.test.ts`

Expected: FAIL because schemas and `foldEvents` do not exist.

- [ ] **Step 3: Implement explicit event and entity schemas**

Expose these exact types:

```ts
export type InfEvent = z.infer<typeof InfEventSchema>;
export interface FoldResult {
  catalog: MaterializedCatalog;
  quarantine: QuarantinedEvent[];
}
export function foldEvents(events: readonly unknown[]): FoldResult;
```

Use a discriminated union for all event types in the spec. Validate every
payload before mutation. Sort valid events by `occurredAt`, then `eventId`.

- [ ] **Step 4: Implement category, tag, favorite, archive, seen, review, and tombstone folds**

Keep handlers as small functions keyed by event type. `infographic.deleted`
removes the item from active/public materialized results but does not erase
review events from the private recovery stream.

- [ ] **Step 5: Run fold tests and full domain tests GREEN**

Run: `pnpm --filter @inf/domain test`

Expected: PASS with no warnings.

- [ ] **Step 6: Commit contracts and folding**

```bash
git add packages/contracts packages/domain
git commit -m "feat: add immutable learning event model"
```

---

### Task 4: Implement deterministic search, surprise, and review scheduling

**Files:**
- Create: `packages/domain/src/search.ts`
- Create: `packages/domain/src/surprise.ts`
- Create: `packages/domain/src/review-schedule.ts`
- Create: `packages/domain/test/search.test.ts`
- Create: `packages/domain/test/surprise.test.ts`
- Create: `packages/domain/test/review-schedule.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `MaterializedInfographic` and `ReviewRating` from contracts.
- Produces: `searchCatalog`, `surpriseWeight`, `selectWeighted`, and `scheduleReview` pure functions.

- [ ] **Step 1: Write failing normalized search tests**

```ts
test("matches title, notes, tags, categories, author, and source URL", () => {
  expect(searchCatalog([itemFixture()], "cuda")).toHaveLength(1);
  expect(searchCatalog([itemFixture()], "nvidia.com")).toHaveLength(1);
  expect(searchCatalog([itemFixture()], "missing")).toHaveLength(0);
});
```

- [ ] **Step 2: Write failing surprise formula and seed tests**

```ts
test("boosts never-seen and under-reviewed material", () => {
  expect(surpriseWeight(neverSeenFixture(), now)).toBeGreaterThan(
    surpriseWeight(frequentlySeenFixture(), now),
  );
});

test("returns the same selection for identical catalog and seed", () => {
  expect(selectWeighted(items, "2026-08-20:aserdargun:4", now).id)
    .toBe(selectWeighted(items, "2026-08-20:aserdargun:4", now).id);
});
```

- [ ] **Step 3: Write failing scheduling table tests**

```ts
test.each([
  ["again", null, 1], ["hard", null, 3], ["good", null, 7], ["easy", null, 14],
  ["again", 14, 1], ["hard", 10, 12], ["good", 10, 20], ["easy", 10, 30],
])("schedules %s from %s days", (rating, previous, expected) => {
  expect(scheduleReview(rating, previous, reviewedAt).intervalDays).toBe(expected);
});
```

- [ ] **Step 4: Run the three tests and observe RED**

Run: `pnpm --filter @inf/domain vitest run test/search.test.ts test/surprise.test.ts test/review-schedule.test.ts`

Expected: FAIL on missing exports.

- [ ] **Step 5: Implement minimal pure functions**

Use the exact formula and intervals from the spec. The seeded PRNG takes a
string seed, hashes it into a 32-bit state, and uses a documented Mulberry32
step. Do not call `Math.random()`.

- [ ] **Step 6: Run tests GREEN and commit**

```bash
pnpm --filter @inf/domain test
git add packages/domain
git commit -m "feat: add deterministic learning algorithms"
```

---

### Task 5: Enforce authentication and public projection boundaries

**Files:**
- Create: `api/src/auth/principal.ts`
- Create: `api/src/auth/authorize.ts`
- Create: `api/src/http/public-projection.ts`
- Create: `api/test/auth.test.ts`
- Create: `api/test/public-projection.test.ts`

**Interfaces:**
- Consumes: `x-ms-client-principal`, request URL, environment settings, and `MaterializedInfographic`.
- Produces: `authorizeOwner(input): AuthDecision` and `toPublicInfographic(item): PublicInfographic`.

- [ ] **Step 1: Write failing owner and local-bypass tests**

```ts
test("accepts only the configured GitHub owner", () => {
  expect(authorizeOwner(ownerInput("aserdargun"))).toEqual({ authorized: true, mode: "github" });
  expect(authorizeOwner(ownerInput("another-user"))).toEqual({ authorized: false, status: 403 });
});

test("local bypass requires loopback, explicit flag, no Azure signal, and proxy token", () => {
  expect(authorizeOwner(validLocalBypassInput()).authorized).toBe(true);
  expect(authorizeOwner({ ...validLocalBypassInput(), hostname: "192.168.1.20" }).authorized).toBe(false);
});
```

- [ ] **Step 2: Write the failing public allowlist test**

```ts
test("never serializes private learning fields", () => {
  const value = toPublicInfographic(privateFixture());
  expect(value).toEqual({ id: "inf-1", title: "GPU Guide", publishedAt, thumbnailUrl, imageUrl });
  expect(JSON.stringify(value)).not.toMatch(/notes|sourceUrl|seenCount|review|favorite/);
});
```

- [ ] **Step 3: Run tests and observe RED**

Run: `pnpm --filter @inf/api vitest run test/auth.test.ts test/public-projection.test.ts`

- [ ] **Step 4: Implement principal parsing and constant-time proxy-token comparison**

Parse the base64 Azure principal defensively. Compare GitHub usernames
case-insensitively and local proxy tokens with `timingSafeEqual` only after
equal byte length.

- [ ] **Step 5: Implement a constructive public serializer**

Return a new object with exactly five public properties. Do not spread the
private input.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm --filter @inf/api test
git add api/src/auth api/src/http api/test
git commit -m "feat: enforce owner and public data boundaries"
```

---

### Task 6: Build the defensive image ingestion pipeline

**Files:**
- Create: `api/src/images/validate-image.ts`
- Create: `api/src/images/process-image.ts`
- Create: `api/src/images/hash.ts`
- Create: `api/test/images.test.ts`
- Create: `api/test/fixtures/valid-infographic.png`
- Create: `api/test/fixtures/not-an-image.png`

**Interfaces:**
- Consumes: `{ bytes: Buffer; declaredMime: string; maxBytes: number; maxPixels: number }`.
- Produces: `processImage(input): Promise<ProcessedImage>` with SHA-256, detected MIME, dimensions, unchanged original bytes, and WebP thumbnail.

- [ ] **Step 1: Write failing size, MIME, decode, pixel, hash, and thumbnail tests**

```ts
test("rejects a MIME declaration that does not match decoded content", async () => {
  await expect(processImage({ ...validInput(), declaredMime: "image/jpeg" }))
    .rejects.toMatchObject({ code: "MIME_MISMATCH" });
});

test("preserves original bytes and produces a bounded WebP thumbnail", async () => {
  const input = validInput();
  const result = await processImage(input);
  expect(result.originalBytes.equals(input.bytes)).toBe(true);
  expect(result.thumbnailMime).toBe("image/webp");
  expect(result.thumbnailWidth).toBeLessThanOrEqual(960);
});
```

- [ ] **Step 2: Run image tests and observe RED**

Run: `pnpm --filter @inf/api vitest run test/images.test.ts`

- [ ] **Step 3: Implement validation and SHA-256**

Allow only PNG, JPEG, WebP, GIF, and AVIF. Default `maxBytes` to `20_000_000`
and `maxPixels` to `40_000_000`. Set Sharp `limitInputPixels` explicitly.

- [ ] **Step 4: Implement the WebP thumbnail**

Use `rotate()` for embedded orientation, `resize({ width: 960, height: 960,
fit: "inside", withoutEnlargement: true })`, and `webp({ quality: 82 })`.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm --filter @inf/api vitest run test/images.test.ts
git add api/src/images api/test/images.test.ts api/test/fixtures
git commit -m "feat: add defensive image processing"
```

---

### Task 7: Implement storage ports, local Drive simulation, Google Drive, and sync

**Files:**
- Create: `api/src/storage/storage-port.ts`
- Create: `api/src/storage/local-drive-adapter.ts`
- Create: `api/src/storage/google-drive-adapter.ts`
- Create: `api/src/storage/event-store.ts`
- Create: `api/src/services/sync-service.ts`
- Create: `api/src/services/capture-service.ts`
- Create: `api/test/storage-contract.ts`
- Create: `api/test/local-drive-adapter.test.ts`
- Create: `api/test/google-drive-adapter.integration.test.ts`
- Create: `api/test/sync-service.test.ts`

**Interfaces:**
- Consumes: image processor, contracts, public/private root IDs, and OAuth credentials.
- Produces: `StoragePort`, `EventStore`, `CaptureService`, and `SyncService`.

- [ ] **Step 1: Write the adapter contract before either adapter**

```ts
export interface StoragePort {
  listChildren(folderId: string): Promise<StoredFile[]>;
  readFile(fileId: string): Promise<Buffer>;
  createFile(input: CreateFileInput): Promise<StoredFile>;
  moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void>;
  trashFile(fileId: string): Promise<void>;
  findByAppProperty(rootId: string, key: string, value: string): Promise<StoredFile[]>;
  isDescendant(fileId: string, rootId: string): Promise<boolean>;
}
```

The shared contract test creates, reads, searches, moves, proves ancestry, and
trashes one fixture without assuming adapter implementation.

- [ ] **Step 2: Run local adapter contract and observe RED**

Run: `pnpm --filter @inf/api vitest run test/local-drive-adapter.test.ts`

- [ ] **Step 3: Implement the local adapter and immutable EventStore**

Map synthetic folder IDs to directories beneath `INF_LOCAL_STORAGE_ROOT`.
Write file metadata to sidecar JSON in tests only. Use exclusive file creation
for immutable events and reject duplicate event IDs.

- [ ] **Step 4: Run local adapter contract GREEN**

Run: `pnpm --filter @inf/api vitest run test/local-drive-adapter.test.ts`

- [ ] **Step 5: Write failing sync and compensation tests**

```ts
test("discovers a manual Inbox image and creates thumbnail plus event", async () => {
  await fixture.putManualInboxImage("diagram.png");
  const report = await sync.syncInbox();
  expect(report).toMatchObject({ imported: 1, duplicates: 0, rejected: 0 });
  expect(await fixture.events()).toContainEqual(expect.objectContaining({ type: "infographic.created" }));
});

test("trashes only derivatives created by a failed import", async () => {
  storage.failOnCreateNumber(3);
  await expect(sync.syncInbox()).rejects.toThrow();
  expect(storage.preExistingFiles()).toEqual(before);
  expect(storage.liveCreatedFiles()).toHaveLength(0);
});
```

- [ ] **Step 6: Implement capture and bounded sync services**

`SyncService.syncInbox({ limit: 50 })` processes untracked image files in a
stable `(createdTime, fileId)` order. Duplicates move to `Duplicates` without
deleting. Invalid images remain recoverable and emit `sync.fileRejected`.

- [ ] **Step 7: Implement the Google Drive adapter**

Use `google.drive({ version: "v3", auth })`. Escape Drive query strings. Limit
every list call to the configured roots, paginate fully, use `appProperties`
for `infSha256` and `infId`, and retry only `429`, `500`, `502`, `503`, and
`504` with delays `250`, `500`, and `1000` ms plus deterministic test jitter 0.

- [ ] **Step 8: Run unit tests GREEN; keep live integration conditional**

Run:

```bash
pnpm --filter @inf/api test
INF_DRIVE_INTEGRATION=1 pnpm --filter @inf/api vitest run test/google-drive-adapter.integration.test.ts
```

Expected now: unit suite PASS; live test SKIP with an explicit message until
Task 15 supplies credentials and test folder IDs.

- [ ] **Step 9: Commit storage and sync**

```bash
git add api/src/storage api/src/services api/test
git commit -m "feat: add Drive-backed capture and sync"
```

---

### Task 8: Expose owner and public HTTP APIs

**Files:**
- Create: `api/src/http/errors.ts`
- Create: `api/src/http/parse.ts`
- Create: `api/src/services/catalog-service.ts`
- Create: `api/src/services/review-service.ts`
- Create: `api/src/functions/public.ts`
- Create: `api/src/functions/owner.ts`
- Modify: `api/src/index.ts`
- Create: `api/test/http-public.test.ts`
- Create: `api/test/http-owner.test.ts`

**Interfaces:**
- Consumes: auth, storage, sync, catalog, image, domain, and Zod contracts.
- Produces: registered Azure Functions for every endpoint in spec section 13.

- [ ] **Step 1: Write failing anonymous public API tests**

```ts
test("lists only public projection fields without authentication", async () => {
  const response = await publicList(request("GET", "/api/public/infographics"), context);
  expect(response.status).toBe(200);
  expect(await json(response)).toEqual([publicFixture()]);
});

test("refuses an image outside the configured public root", async () => {
  const response = await publicImage(request("GET", "/api/public/images/private-file"), context);
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Write failing private owner API tests**

Cover 401, 403, owner 200, multipart capture, sync, metadata patch, confirmed
delete, seen, review, surprise, due review, and settings stats.

- [ ] **Step 3: Run HTTP tests and observe RED**

Run: `pnpm --filter @inf/api vitest run test/http-public.test.ts test/http-owner.test.ts`

- [ ] **Step 4: Implement catalog and review services**

The catalog service folds events once per request, filters deleted items, and
returns typed DTOs. The review service records the calculated interval and
`dueAt` in `review.recorded`.

- [ ] **Step 5: Implement thin Azure Functions registrations**

Each registration calls a tested handler and maps `AppError` codes to status
codes. Do not put domain logic inside `app.http(...)` callbacks.

- [ ] **Step 6: Run API tests, build API artifact, and commit**

```bash
pnpm --filter @inf/api test
pnpm api:build
git add api packages/contracts
git commit -m "feat: expose INF managed APIs"
```

---

### Task 9: Build the approved app shell, login, navigation, and Today dashboard

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/view/page.tsx`
- Create: `app/infographic/page.tsx`
- Create: `components/app-shell.tsx`
- Create: `components/sidebar-nav.tsx`
- Create: `components/mobile-nav.tsx`
- Create: `components/theme-toggle.tsx`
- Create: `components/ui/button.tsx`
- Create: `components/ui/media-frame.tsx`
- Create: `components/ui/page-state.tsx`
- Create: `features/today/today-page.tsx`
- Create: `lib/api-client.ts`
- Create: `lib/routes.ts`
- Create: `e2e/shell.spec.ts`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Accepted `docs/design` concepts and owner catalog/stats DTOs.
- Produces: responsive shell, explicit GitHub login, shared API client, and Today screen.

- [ ] **Step 1: Write the failing shell Playwright test**

```ts
test("owner sees Today navigation and primary learning actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Surprise me" })).toBeVisible();
});
```

- [ ] **Step 2: Run Playwright and observe RED**

Run: `pnpm playwright test e2e/shell.spec.ts`

Expected: FAIL because the approved shell and heading are absent.

- [ ] **Step 3: Implement the API client and route map**

```ts
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T>;
export const routes = {
  today: "/", inbox: "/inbox/", library: "/library/", add: "/add/",
  review: "/review/", surprise: "/surprise/", settings: "/settings/", view: "/view/",
} as const;
```

Throw a typed `ApiClientError` with status and safe message on non-2xx.

- [ ] **Step 4: Implement shell and Today from accepted tokens**

Use semantic nav, visible focus, sidebar desktop, bottom nav mobile, light/dark
tokens, and exact approved labels. Today loads stats/recent items with loading,
empty, error, and success states.

- [ ] **Step 5: Run desktop and mobile shell tests GREEN**

Run: `pnpm playwright test e2e/shell.spec.ts --project=chromium`

- [ ] **Step 6: Compare implementation screenshot to accepted concepts**

Capture desktop and mobile screenshots, inspect them with `view_image` beside
the concepts, repair mismatches in typography, spacing, color, icon weight,
and container model before committing.

- [ ] **Step 7: Commit shell and Today**

```bash
git add app components features/today lib e2e/shell.spec.ts
git commit -m "feat: build INF owner shell"
```

---

### Task 10: Deliver Paste → Save → Inbox → Categorize/Tag

**Files:**
- Create: `app/add/page.tsx`
- Create: `app/inbox/page.tsx`
- Create: `features/capture/capture-dropzone.tsx`
- Create: `features/capture/capture-form.tsx`
- Create: `features/capture/use-clipboard-image.ts`
- Create: `features/inbox/inbox-page.tsx`
- Create: `features/inbox/inbox-row.tsx`
- Create: `features/inbox/category-editor.tsx`
- Create: `features/inbox/tag-editor.tsx`
- Create: `e2e/capture-inbox.spec.ts`

**Interfaces:**
- Consumes: `POST /api/infographics`, `POST /api/sync`, catalog DTOs, and accepted UI components.
- Produces: complete low-friction capture and processing flow.

- [ ] **Step 1: Write the failing capture-to-inbox Playwright test**

```ts
test("uploads without metadata, then categorizes and tags in Inbox", async ({ page }) => {
  await page.goto("/add/");
  await page.getByLabel("Choose infographic").setInputFiles("e2e/fixtures/learning-loop.png");
  await expect(page.getByRole("img", { name: "Infographic preview" })).toBeVisible();
  await page.getByRole("button", { name: "Save to Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox\//);
  await page.getByLabel("Category").fill("GPU");
  await page.getByLabel("Tags").fill("memory, cuda");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Moved to Library")).toBeVisible();
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm playwright test e2e/capture-inbox.spec.ts`

- [ ] **Step 3: Implement unified picker/drop/paste state**

Expose one `selectFile(file: File)` path for picker, drop, and clipboard. Reject
non-image clipboard items with an accessible status. Revoke old object URLs
when preview changes or component unmounts.

- [ ] **Step 4: Implement optional metadata and save**

Submit `FormData` only after client size/MIME checks. Keep title, source URL,
source platform, and notes optional. Disable duplicate submissions and expose
safe server errors.

- [ ] **Step 5: Implement Inbox inline editing and Drive sync action**

Category assignment emits the processing event and moves Drive original from
Inbox to Library through the API. Tag entry trims, normalizes, deduplicates,
and preserves display case.

- [ ] **Step 6: Add clipboard and keyboard variants to the E2E test**

Dispatch a browser `ClipboardEvent` with the PNG fixture and prove preview;
verify focus order and Enter/Space behavior for upload controls.

- [ ] **Step 7: Run GREEN, visual compare, and commit**

```bash
pnpm playwright test e2e/capture-inbox.spec.ts
git add app/add app/inbox features/capture features/inbox e2e
git commit -m "feat: deliver capture and Inbox workflow"
```

---

### Task 11: Deliver Library search/filter and owner detail actions

**Files:**
- Create: `app/library/page.tsx`
- Create: `features/library/library-page.tsx`
- Create: `features/library/library-grid.tsx`
- Create: `features/library/library-filters.tsx`
- Create: `features/library/infographic-tile.tsx`
- Create: `features/detail/infographic-detail.tsx`
- Create: `features/detail/delete-dialog.tsx`
- Create: `e2e/library-detail.spec.ts`

**Interfaces:**
- Consumes: owner catalog/detail/patch/delete APIs and deterministic query conventions.
- Produces: image-first library, URL-persisted filters, rewritten detail shell, favorite/archive/delete actions.

- [ ] **Step 1: Write failing library/detail test**

```ts
test("searches, opens, favorites, archives, and confirms delete", async ({ page }) => {
  await seedInfographic(page, { title: "Memory hierarchy", category: "GPU" });
  await page.goto("/library/?q=memory&category=gpu");
  await page.getByRole("link", { name: /Memory hierarchy/ }).click();
  await expect(page).toHaveURL(/\/infographic\/[^/]+/);
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await expect(page.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm playwright test e2e/library-detail.spec.ts`

- [ ] **Step 3: Implement grid, filters, and query persistence**

Filters use native links or `history.replaceState` and remain restorable on
reload. Use the API's deterministic normalized search and stable sort options.

- [ ] **Step 4: Implement the rewritten detail shell**

Read the ID from `window.location.pathname` only in a client effect. Load the
owner detail API and render large protected image, metadata, history, seen
count, and actions.

- [ ] **Step 5: Implement confirmed delete and archive semantics**

Delete dialog names the item, requires a second destructive button, returns
focus on cancel, and routes to Library after success. Archive removes owner
Library visibility but does not remove public View Mode visibility.

- [ ] **Step 6: Run GREEN, check empty/filter/mobile states, and commit**

```bash
pnpm playwright test e2e/library-detail.spec.ts
git add app/library features/library features/detail e2e
git commit -m "feat: add library and infographic detail"
```

---

### Task 12: Deliver Surprise, Review, and owner Settings

**Files:**
- Create: `app/surprise/page.tsx`
- Create: `app/review/page.tsx`
- Create: `app/settings/page.tsx`
- Create: `features/surprise/surprise-page.tsx`
- Create: `features/review/review-page.tsx`
- Create: `features/review/rating-controls.tsx`
- Create: `features/settings/settings-page.tsx`
- Create: `features/settings/export-inventory.ts`
- Create: `e2e/learning.spec.ts`

**Interfaces:**
- Consumes: surprise, seen, review queue, review mutation, stats, and Drive health APIs.
- Produces: intentional resurfacing, persisted ratings, due scheduling UI, and operational settings.

- [ ] **Step 1: Write failing Surprise and Review persistence test**

```ts
test("marks Surprise seen and persists a Good review after reload", async ({ page }) => {
  await page.goto("/surprise/");
  await expect(page.getByRole("img", { name: /Infographic/ })).toBeVisible();
  await page.goto("/review/");
  await page.getByRole("button", { name: "Good" }).click();
  await page.reload();
  await expect(page.getByText(/Next review/)).toBeVisible();
});
```

- [ ] **Step 2: Run and observe RED**

Run: `pnpm playwright test e2e/learning.spec.ts`

- [ ] **Step 3: Implement Surprise with intentional seen mutation**

Render the selected item first, then send one idempotent seen mutation keyed by
the selection event ID. Do not increment on image reload or React rerender.

- [ ] **Step 4: Implement Review ratings and queue progression**

All four buttons show keyboard shortcuts `1`-`4`, announce saved status, and
advance only after the API confirms persistence. Empty due queues have a
meaningful completion state, not a fake scheduled item.

- [ ] **Step 5: Implement Settings health and backup explanation**

Show public/private folder health, counts, quarantine records, PWA guidance,
app/runtime versions, and the no-AI statement. Add an `Export inventory JSON`
action that downloads the owner catalog as schema-versioned standard JSON with
Drive file IDs and SHA-256 values but no credentials. Add owner-only `Open
public image folder` and `Open private backup folder` links so both Drive roots
can be copied or downloaded for full recovery. The browser test must exercise
the JSON download and assert its schema version and item count. Do not show
secret values or folder-owner email.

- [ ] **Step 6: Run GREEN, verify keyboard/mobile, and commit**

```bash
pnpm playwright test e2e/learning.spec.ts
git add app/surprise app/review app/settings features/surprise features/review features/settings e2e
git commit -m "feat: add resurfacing and review mode"
```

---

### Task 13: Deliver anonymous View Mode and installable PWA

**Files:**
- Create: `features/public-view/public-gallery.tsx`
- Create: `features/public-view/public-detail.tsx`
- Create: `components/public-shell.tsx`
- Create: `public/sw.js`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/maskable-512.png`
- Create: `features/pwa/service-worker-registration.tsx`
- Create: `e2e/public-view.spec.ts`
- Create: `e2e/pwa.spec.ts`
- Modify: `app/view/page.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: public API allowlist and accepted public concept.
- Produces: anonymous gallery/detail, no owner-data leak, manifest/icons/service-worker installation foundation.

- [ ] **Step 1: Write failing anonymous isolation test**

```ts
test("anonymous visitor sees View Mode but cannot read owner APIs", async ({ request, page }) => {
  await page.goto("/view/");
  await expect(page.getByRole("heading", { name: "Infographics" })).toBeVisible();
  expect((await request.get("/api/infographics")).status()).toBe(401);
  const publicBody = await (await request.get("/api/public/infographics")).json();
  expect(JSON.stringify(publicBody)).not.toMatch(/notes|review|sourceUrl|seenCount/);
});
```

- [ ] **Step 2: Write failing PWA asset test**

Assert manifest `display: standalone`, three local icon entries, theme colors,
service worker registration, and no cross-origin font or analytics request.

- [ ] **Step 3: Run tests and observe RED**

Run: `pnpm playwright test e2e/public-view.spec.ts e2e/pwa.spec.ts`

- [ ] **Step 4: Implement public gallery/detail from the public client only**

Do not import owner hooks or owner DTOs. Public detail parses `/view/{id}` from
the path and calls only `/api/public/*`. Use a restrained image grid and large
read-only viewer.

- [ ] **Step 5: Implement bounded service-worker caching**

Cache only versioned static shell assets and last successful public/catalog GET
responses. Never cache private mutations, login endpoints, or error responses.
Use stale-while-revalidate for thumbnails and network-first for catalogs.

- [ ] **Step 6: Run GREEN, inspect public concepts, and commit**

```bash
pnpm playwright test e2e/public-view.spec.ts e2e/pwa.spec.ts
git add app/view components/public-shell.tsx features/public-view features/pwa public e2e
git commit -m "feat: add public View Mode and PWA"
```

---

### Task 14: Add safe local lifecycle, complete documentation, and release validation

**Files:**
- Create: `scripts/local-dev.mjs`
- Create: `scripts/stop-local.mjs`
- Create: `tools/local-dev.test.mjs`
- Create: `tools/stop-local.test.mjs`
- Create: `tools/codex-environment.test.mjs`
- Create: `.codex/environments/environment.toml`
- Create: `.env.example`
- Create: `README.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/PRODUCT.md`
- Create: `docs/INGESTION.md`
- Create: `docs/ROADMAP.md`
- Create: `docs/design/FIDELITY_LEDGER.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: all local app/API artifacts and exact ports 3000, 7071, and 4280.
- Produces: Setup/Run/Validate/Stop Codex actions and full release evidence.

- [ ] **Step 1: Write failing environment and safe-stop tests**

The tests must assert ordered action names `Run`, `Validate`, `Stop`; manifest
delegation to `dev:codex`, `validate:codex`, `stop:codex`; owned-listener
termination; foreign-cwd refusal; idempotent free-port success; and child
process cleanup.

- [ ] **Step 2: Run lifecycle tests and observe RED**

Run:

```bash
node --test tools/codex-environment.test.mjs tools/local-dev.test.mjs tools/stop-local.test.mjs
```

- [ ] **Step 3: Implement checkout-scoped local orchestration**

`local-dev.mjs` generates a random private proxy token, writes a checkout-local
control file beneath `.codex/run/`, starts Next on 3000, compiled Functions on
7071, and SWA CLI on 4280, and forwards signals to the full process group.

`stop-local.mjs` resolves listener PIDs and working directories. It sends TERM,
waits five seconds, then sends KILL only to the same already-verified PIDs. It
never uses `pkill` or broad process-name matching.

- [ ] **Step 4: Add exact environment actions and validation scripts**

```toml
# THIS IS AUTOGENERATED. DO NOT EDIT MANUALLY
version = 1
name = "INF Personal Infographic Learning System"

[setup]
script = "corepack enable && corepack prepare pnpm@11.22.0 --activate && pnpm install --frozen-lockfile && pnpm exec playwright install chromium"

[[actions]]
name = "Run"
icon = "run"
command = "pnpm dev:codex"

[[actions]]
name = "Validate"
icon = "tool"
command = "pnpm validate:codex"

[[actions]]
name = "Stop"
icon = "tool"
command = "pnpm stop:codex"
```

`validate:codex` runs lifecycle tests, lint, typecheck, all Vitest, static/API
builds, artifact verification, Playwright, and `git diff --check`.

- [ ] **Step 5: Run lifecycle tests GREEN**

Run the exact Node test command from Step 2 and confirm all ownership paths.

- [ ] **Step 6: Write user and architecture documentation**

README documents Setup/Run/Validate/Stop, local auth, Drive OAuth, manual Drive
capture, storage, PWA, backup, Azure deployment, and custom-domain exclusion.
INGESTION specifies the future token-authenticated endpoint without enabling
it. ROADMAP separates MVP from manual prompts, SM-2, statistics, and
review-based gamification.

- [ ] **Step 7: Exercise exact Setup, Validate, Run, browser, and Stop actions**

Run Setup from TOML, then `pnpm validate:codex`. Start Run, wait for
`http://127.0.0.1:4280`, execute public and owner browser flows, inspect console,
capture desktop/mobile screenshots, then run Stop and prove all three ports
are free.

- [ ] **Step 8: Complete the visual fidelity ledger**

Compare accepted and implementation screenshots with `view_image`. Record at
least copy, layout, typography, palette, icon, image treatment, spacing,
desktop/mobile behavior, and interaction mismatches plus fixes. Remove QA
screenshots not designated as accepted evidence.

- [ ] **Step 9: Commit lifecycle and documentation**

```bash
git add .codex .env.example package.json scripts tools README.md docs
git commit -m "chore: complete local release contract"
```

---

### Task 15: Provision and verify the live Google Drive boundary

**Files:**
- Create: `scripts/google-drive-authorize.mjs`
- Create: `scripts/google-drive-provision.mjs`
- Modify: `.env.example`
- Test: `api/test/google-drive-adapter.integration.test.ts`

**Interfaces:**
- Consumes: authenticated Google owner, public root ID, local OAuth client credentials.
- Produces: public child folder IDs, restricted `INF-PRIVATE-DATA`, a dedicated private integration-test folder, ignored local credentials, and green live Drive adapter tests.

- [ ] **Step 1: Write the OAuth authorization helper without logging secrets**

Use a Desktop OAuth client, loopback callback, PKCE/state validation, and the
Drive scope required for owner-created watched files. Write client ID, client
secret, refresh token, and derived folder IDs only to `.env.local` with mode
0600. Print only folder names/IDs and success status.

- [ ] **Step 2: Create or select the Google Cloud project and enable Drive API**

Use the authenticated Google account. Name the project and OAuth app
`inf-aserdargun-com`. Configure the consent screen for the owner account and
create the Desktop OAuth client consumed by Step 1.

- [ ] **Step 3: Run authorization and verify the account without exposing tokens**

Run: `node scripts/google-drive-authorize.mjs`

Expected: browser consent completes; helper confirms the Drive owner identity;
`.env.local` exists with 0600 permissions; terminal contains no token value.

- [ ] **Step 4: Provision exact folder structure idempotently**

Run: `node scripts/google-drive-provision.mjs`

The helper must verify public root ID and owner, create missing `Inbox`,
`Library`, `Archive`, `Duplicates`, and `Thumbnails`, create restricted sibling
`INF-PRIVATE-DATA` with `events`, `reviews`, `quarantine`, and `exports`, and
create a restricted integration-test root. Re-running returns the same IDs and
does not create duplicates.

- [ ] **Step 5: Verify permissions before writing test content**

Read back permission metadata. Public root remains `anyone: reader`. Private
and test roots have no `anyone`, domain, or unrelated-user permission. Stop if
the owner or visibility differs.

- [ ] **Step 6: Run live Drive integration tests and clean test fixtures**

Run:

```bash
set -a
source .env.local
set +a
INF_DRIVE_INTEGRATION=1 pnpm --filter @inf/api vitest run test/google-drive-adapter.integration.test.ts
```

Expected: create/read/property-search/move/ancestry/trash PASS. The test uses
only the dedicated test root and trashes its temporary files.

- [ ] **Step 7: Re-run complete local validation and commit helpers only**

```bash
pnpm validate:codex
git add scripts/google-drive-authorize.mjs scripts/google-drive-provision.mjs .env.example api/test/google-drive-adapter.integration.test.ts
git commit -m "chore: add Drive provisioning workflow"
```

Confirm `.env.local` and all credential material remain untracked.

---

### Task 16: Publish GitHub, deploy Free Azure Static Web Apps, verify, and stop before custom domain

**Files:**
- Create: `.github/workflows/deploy-swa-inf-aserdargun-com.yml`
- Create: `scripts/verify-deployment-contract.mjs`
- Modify: `README.md` only if the generated hostname must be recorded after verification.

**Interfaces:**
- Consumes: clean validated `main`, live Drive secrets, GitHub `aserdargun`, enabled `aserdargun subscription`.
- Produces: public GitHub repository, exact Free SWA resources, correlated successful deployment, generated-host verification, and no custom domain.

- [ ] **Step 1: Invoke `deploying-aserdargun-azure-static-web-apps` and resolve exact identifiers**

Run:

```bash
python3 /Users/aserdargun/.codex/skills/deploying-aserdargun-azure-static-web-apps/scripts/deployment_contract.py --repo-name inf-aserdargun-com
```

Expected identifiers must be exactly the names in Global Constraints. Stop on
any mismatch.

- [ ] **Step 2: Run GitHub/Azure/account/worktree preflight**

Verify `gh auth status`, `az account show`, `git status`, branch `main`, no
remote collision, no existing incompatible `rg-inf-aserdargun-com` or
`swa-inf-aserdargun-com`, and no existing repository with incompatible
visibility/default branch.

- [ ] **Step 3: Write and test the deployment contract helper**

The helper parses the workflow and fails unless it has:

```yaml
permissions:
  contents: read
concurrency:
  group: deploy-swa-inf-aserdargun-com
  cancel-in-progress: false
```

It also requires `main`, `out`, `api-dist`, one derived token secret,
`skip_app_build: true`, `skip_api_build: true`, empty `output_location`, and no
custom-domain command.

- [ ] **Step 4: Create the pinned production workflow**

Pin the currently verified immutable commits:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`
- `Azure/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1`

The workflow installs pnpm 11.22.0, runs `pnpm validate:codex` except local
browser tests that require the emulator already covered in CI-safe form,
builds `out/` and `api-dist/`, verifies both, and deploys the prebuilt paths.

- [ ] **Step 5: Run the complete local release contract one final time**

Run: `pnpm validate:codex`

Expected: lint, typecheck, all unit/integration, build, artifact, browser, diff,
and lifecycle tests PASS with no server left running.

- [ ] **Step 6: Create the public GitHub repository and push validated main**

If no compatible remote exists:

```bash
gh repo create aserdargun/inf-aserdargun-com --public --source . --remote origin
git push -u origin main
```

Verify remote owner, visibility, default branch, and matching local/remote SHA.

- [ ] **Step 7: Provision exact Free Azure resources without source integration**

Create `rg-inf-aserdargun-com` in West Europe and
`swa-inf-aserdargun-com` on the Free SKU without asking Azure to generate a
workflow. Verify provisioning state, generated hostname, SKU, region, tenant,
subscription, and empty custom-domain list.

- [ ] **Step 8: Set secrets without printing values**

Pipe the SWA deployment token directly into the derived GitHub Actions secret.
Set `INF_ALLOWED_GITHUB_USER`, Google OAuth values, public/private folder IDs,
and production environment signal as Azure Static Web Apps application
settings with command output suppressed. Verify only setting names and update
timestamps.

- [ ] **Step 9: Commit the workflow, push, and monitor correlation**

```bash
git add .github/workflows/deploy-swa-inf-aserdargun-com.yml scripts/verify-deployment-contract.mjs
git commit -m "ci: deploy INF to Azure Static Web Apps"
git push origin main
```

Monitor the triggered run. The successful deploy step, production branch SHA,
Azure environment update time, and remote `main` SHA must correlate.

- [ ] **Step 10: Verify the Azure-generated host**

Check HTTPS 200, content identity, content types, static assets, manifest,
service worker, anonymous View Mode, anonymous private-route rejection,
GitHub owner login/session, Drive sync, owner capture, public projection,
mobile/desktop overflow, browser console, and production-targeted Playwright
where the interactive login session is available.

- [ ] **Step 11: Prove the custom-domain boundary and stop**

Run a fresh Azure custom-domain list query and require `[]`. Do not open IHS,
do not add `inf.aserdargun.com`, and do not create TXT/CNAME/certificate work.
Return the verified generated `*.azurestaticapps.net` URL, correlated commit
and workflow IDs, test counts, Drive permission evidence, and the explicit
statement “custom domain not configured.”

---

## Final Self-Review Checklist

- [ ] Every spec section maps to at least one task above.
- [ ] Every behavior task begins with a failing automated test and explicit RED command.
- [ ] Shared signatures match across contracts, domain, API, and frontend tasks.
- [ ] Public View Mode cannot import owner DTOs or access the private event root.
- [ ] Drive public/private permissions are verified live before deployment.
- [ ] Setup, Run, Validate, and Stop are exercised exactly, not inferred.
- [ ] Accepted concepts and final browser screenshots receive side-by-side `view_image` inspection.
- [ ] No credential, `.env.local`, OAuth token, deployment token, or personal note is tracked or printed.
- [ ] GitHub/Azure deployment is correlated to one validated commit.
- [ ] Azure custom-domain list is empty and no DNS operation occurred.
