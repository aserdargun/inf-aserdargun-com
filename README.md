# INF — Personal Infographic Learning System

INF is a personal, image-first learning notebook. Capture an infographic, organize it, resurface it, and record recall. `/view` is an intentionally public, read-only image collection; all learning records remain private.

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

Run uses loopback-only ports: Next 3000, Functions 7071, a private local API capability hop 7072, and the Static Web Apps emulator 4280. A random capability is kept only in ignored `.codex/run/`; it is injected server-to-server by the local API proxy and is never shipped to browser JavaScript. The local emulator relaxes only SWA route roles while API owner authorization still requires that capability, exact local bypass flags, loopback, and no Azure production signal. Local storage uses an ignored checkout-private `LocalDriveAdapter` tree. `pnpm stop:codex` identifies listener cwd values, stops only this checkout's processes, and refuses foreign listeners.

## Drive and recovery

Production uses the public root `1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK` and a restricted sibling private root. Create Google OAuth credentials and keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and the private/folder IDs in `.env.local` (0600), never in the frontend or repository. Manual image drops go in public `Inbox`; **Sync Drive** discovers them. INF retains originals, creates WebP thumbnails, and stores immutable private JSON events. Recovery is both Drive roots: copy the public images and private event hierarchy, then rebuild state by folding the events. Settings can export a portable inventory.

Task 15 is not yet live. Do not run these production commands until that task is explicitly opened. The helper performs the loopback OAuth callback, creates/reads folders, asserts permissions, and writes exact runtime names without printing the refresh token. Full Drive scope is deliberate: `drive.file` cannot reliably read the pre-existing shared root or images pasted manually outside this app.

```bash
# Google Cloud Console: enable Drive API, configure the owner's consent screen,
# and create a Desktop OAuth client with a loopback redirect.
umask 077
test ! -e .env.local && cp .env.example .env.local
chmod 600 .env.local
# Edit GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET only; leave other values empty.
node scripts/google-drive-release.mjs authorize --env-file .env.local
node scripts/google-drive-release.mjs provision --env-file .env.local
# Expected read-back: hardcoded public root 1wij...vgsK; exact INF_*_FOLDER_ID
# values; permissionBoundary "public anyone:reader; private restricted".
```

Safe handoff is the mode-0600 ignored `.env.local`; never paste secret values into commands, logs, GitHub, frontend variables, or screenshots. For a manual ingest, paste/upload a supported image into public `Inbox`, run the deployed app, choose **Sync Drive**, and verify it appears and Settings health is healthy. Before migration, export inventory, then make and restore an auditable backup:

```bash
curl -fsS http://127.0.0.1:4280/api/settings/health > /safe/inf-inventory.json
BACKUP=/safe/inf-backup-$(date -u +%Y%m%dT%H%M%SZ)
SCRATCH=/scratch/inf-restore-$(date -u +%Y%m%dT%H%M%SZ)
node scripts/google-drive-release.mjs backup --env-file .env.local --output "$BACKUP"
node scripts/google-drive-release.mjs verify-backup --backup "$BACKUP" --scratch "$SCRATCH" --inventory /safe/inf-inventory.json
# Expected: manifest hashes match, events fold, and inventory identity fields match.
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
