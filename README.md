# Infographics — Personal Infographic Learning System

Infographics is a personal, image-first learning notebook. Capture an infographic, organize it, resurface it, and record recall. `/view` is an intentionally public, read-only image collection; all learning records remain private.

## Local actions

Use Node 22 and pnpm 11.22.0.

```bash
corepack enable && corepack prepare pnpm@11.22.0 --activate && pnpm install --frozen-lockfile && pnpm exec playwright install chromium
pnpm dev:codex
# http://127.0.0.1:4280
pnpm build && pnpm preview:codex # production out/ artifact, same API/auth chain
pnpm validate:codex
pnpm stop:codex
```

Run uses loopback-only ports: Next 3000, Functions 7071, a private local API capability hop 7072, and the Static Web Apps emulator 4280. A random capability is kept only in ignored `.codex/run/`; it is injected server-to-server by the local API proxy and is never shipped to browser JavaScript. The local emulator relaxes only SWA route roles while API owner authorization still requires that capability, exact local bypass flags, loopback, and no Azure production signal. Local storage uses ignored checkout-private atomic `.inf-bundle` objects. Legacy split local data is intentionally not migrated: Stop, run `node scripts/clean-output.mjs .codex/run/storage`, then Run. `pnpm stop:codex` identifies listener cwd values, stops only this checkout's processes, and refuses foreign listeners.

## Auto-trim on capture

Pasting or dropping a screenshot on the Add page usually carries solid margins around the content. The API auto-trims those margins before storing the file so the original and its thumbnail reflect the content's tight bounding box. The trim is server-side and silent: the user sees the same capture flow, and the original Drive file records the pre-trim dimensions for transparency.

- Default is on. Disable with `INF_AUTO_TRIM_SCREENSHOTS=false` (also `0`/`off`/`no`).
- Background is detected from the top-left corner block (transparent corner → alpha canvas). The trim is skipped if the savings fall below `INF_AUTO_TRIM_MIN_SAVINGS` (default 0.02 = 2% of pixels).
- The trim only runs for the **capture** and **image replace** flows. Drive Inbox sync reuses the file bytes as-is so existing manual uploads are not rewritten.
- Failed trims return the input unchanged; the saved file is never smaller or more lossy than the user uploaded.

## Drive and recovery

Production uses the public root `1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK` and a restricted sibling private root. Create Google OAuth credentials and keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and the private/folder IDs in `.env.local` (0600), never in the frontend or repository. Manual image drops go in public `Inbox`; **Sync Drive** discovers them. Infographics retains originals, creates WebP thumbnails, and stores immutable private JSON events. Recovery is both Drive roots: copy the public images and private event hierarchy, then rebuild state by folding the events. Settings can export a portable inventory.

The provisioning workflow performs a bounded loopback-only Desktop OAuth callback with PKCE/state validation, verifies the exact Drive owner, creates or selects the exact folder tree idempotently, fails closed on incomplete permission metadata, and writes credentials plus audit folder IDs without printing secret values. Full Drive scope is deliberate: `drive.file` cannot reliably read the pre-existing shared root or images pasted manually outside this app. Live authorization still requires the owner to complete Google's consent step.

```bash
# Google Cloud Console: enable Drive API, configure the owner's consent screen,
# and create a Desktop OAuth client with a loopback redirect.
umask 077
test ! -e .env.local && cp .env.example .env.local
chmod 600 .env.local
# Edit GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET only; leave other values empty.
node scripts/google-drive-authorize.mjs
node scripts/google-drive-provision.mjs
# Expected read-back: hardcoded public root 1wij...vgsK; exact INF_*_FOLDER_ID
# values; permissionBoundary "public exact owner+anyone:reader; private and
# integration-test owner-only".
```

Safe handoff is the mode-0600 ignored `.env.local`; never paste secret values into commands, logs, GitHub, frontend variables, or screenshots. The private `integration-test` root is owner-only and exists solely for the opt-in live adapter contract; normal tests skip it unless `INF_DRIVE_INTEGRATION=1` and all credentials/IDs are loaded. For a manual ingest, paste/upload a supported image into public `Inbox`, run the deployed app, choose **Sync Drive**, and verify it appears and Settings health is healthy. Sync creates only public-safe catalog projection data: the image remains observable to anonymous visitors in View Mode while notes, source details, tags, categories, review history, and other learning state stay private.

```bash
set -a
source .env.local
set +a
INF_DRIVE_INTEGRATION=1 pnpm --filter @inf/api vitest run test/google-drive-adapter.integration.test.ts
```

The live contract creates, reads, searches, moves, checks ancestry, and trashes deterministic fixtures only inside the restricted test root, then verifies cleanup. It never writes to the production public root.

Before migration, export inventory, then make and restore an auditable backup:

```bash
curl -fsS http://127.0.0.1:4280/api/settings/health > /safe/inf-inventory.json
BACKUP=/safe/inf-backup-$(date -u +%Y%m%dT%H%M%SZ)
SCRATCH=/scratch/inf-restore-$(date -u +%Y%m%dT%H%M%SZ)
node scripts/google-drive-release.mjs backup --env-file .env.local --output "$BACKUP"
node scripts/google-drive-release.mjs verify-backup --backup "$BACKUP" --scratch "$SCRATCH" --inventory /safe/inf-inventory.json
# The verifier safely builds its ignored contracts/domain runtime if Setup left
# every dist/ absent. Expected: hashes match, events fold, inventory fields match.
```

## PWA and deployment

The PWA caches a bounded public read experience only. It does not queue offline writes, synchronize in the background, or make private content offline-safe.

Azure deployment is intentionally a later gated step: GitHub `aserdargun/inf-aserdargun-com`, West Europe Free Static Web Apps, with Google secrets supplied as Azure application settings. This milestone explicitly excludes custom-domain, DNS, IHS, certificate, TXT, and CNAME changes.

Task 16 is not yet live. Before it starts, validate and push the public repository. The helper merges app settings through a 0600 temporary REST body, captures the deployment token in memory, deploys prebuilt `out/` + `api-dist/`, and checks generated-host HTML/API/image/auth/header boundaries without printing secrets.

```bash
pnpm validate:codex
gh repo create aserdargun/inf-aserdargun-com --public --source=. --remote=origin --push
az login
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
az group create --name rg-inf-aserdargun-com --location westeurope
az staticwebapp create --name swa-inf-aserdargun-com --resource-group rg-inf-aserdargun-com --location westeurope --sku Free
node scripts/azure-static-web-app-release.mjs settings --env-file .env.local --subscription "$SUBSCRIPTION_ID" --resource-group rg-inf-aserdargun-com --name swa-inf-aserdargun-com
pnpm build && pnpm api:build && pnpm artifact:verify
node scripts/azure-static-web-app-release.mjs deploy --resource-group rg-inf-aserdargun-com --name swa-inf-aserdargun-com
node scripts/azure-static-web-app-release.mjs verify --resource-group rg-inf-aserdargun-com --name swa-inf-aserdargun-com
# Expected: View/public API 200, public security/cache headers, owner 302/401,
# and customHostnames exactly 0.
```

Do not configure `inf.aserdargun.com`, DNS/IHS/TXT/CNAME records, certificates, or any custom domain in Task 16.
