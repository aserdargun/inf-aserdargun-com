# INF — Personal Infographic Learning System

INF is a personal, image-first learning notebook. Capture an infographic, organize it, resurface it, and record recall. `/view` is an intentionally public, read-only image collection; all learning records remain private.

## Local actions

Use Node 22 and pnpm 11.22.0.

```bash
corepack enable && corepack prepare pnpm@11.22.0 --activate && pnpm install --frozen-lockfile && pnpm exec playwright install chromium
pnpm dev:codex
# http://127.0.0.1:4280
pnpm validate:codex
pnpm stop:codex
```

Run uses loopback-only ports: Next 3000, Functions 7071, a private local API capability hop 7072, and the Static Web Apps emulator 4280. A random capability is kept only in ignored `.codex/run/`; it is injected server-to-server by the local API proxy and is never shipped to browser JavaScript. The local emulator relaxes only SWA route roles while API owner authorization still requires that capability, exact local bypass flags, loopback, and no Azure production signal. Local storage uses an ignored checkout-private `LocalDriveAdapter` tree. `pnpm stop:codex` identifies listener cwd values, stops only this checkout's processes, and refuses foreign listeners.

## Drive and recovery

Production uses the public root `1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK` and a restricted sibling private root. Create Google OAuth credentials and keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and the private/folder IDs in `.env.local` (0600), never in the frontend or repository. Manual image drops go in public `Inbox`; **Sync Drive** discovers them. INF retains originals, creates WebP thumbnails, and stores immutable private JSON events. Recovery is both Drive roots: copy the public images and private event hierarchy, then rebuild state by folding the events. Settings can export a portable inventory.

Task 15 is not yet live. Do not run these production commands until that task is explicitly opened. They are an executable, non-secret handoff procedure:

```bash
# Google Cloud console: create a Desktop OAuth client, enable Drive API, and
# authorize only https://www.googleapis.com/auth/drive.file for the owner.
# Store the resulting values locally; never print the refresh token.
umask 077
cp .env.example .env.local
chmod 600 .env.local
# Edit only placeholder values in .env.local:
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
# GOOGLE_REFRESH_TOKEN=...
# INF_PUBLIC_DRIVE_ROOT_ID=1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK
# INF_PRIVATE_DRIVE_ROOT_ID=...

# With an owner-authorized Drive CLI or API client, create/read back exactly:
# public: Inbox Library Archive Duplicates Thumbnails
# private: INF-PRIVATE-DATA/events reviews quarantine exports
# Record each returned folder id in .env.local, then list permissions for every root.
# Expected: public root has exactly an anyone:reader grant; private root has no
# anyone/domain grant. Stop if that read-back differs.
```

For a manual ingest, paste/upload a supported image into the public `Inbox` folder, start `pnpm dev:codex`, choose **Sync Drive**, and verify the item appears in Library and that Settings health reports no storage errors. Before any migration, make an auditable backup and prove a scratch restore:

```bash
# Replace paths with operator-controlled local backup locations; do not archive secrets.
mkdir -p /safe/inf-backup/{public,private}
find /mounted/public-drive -type f -print | sort > /safe/inf-backup/public.manifest
find /mounted/private-drive -type f -print | sort > /safe/inf-backup/private.manifest
cp -R /mounted/public-drive/. /safe/inf-backup/public/
cp -R /mounted/private-drive/. /safe/inf-backup/private/
diff -ru /safe/inf-backup/public /scratch/inf-restore/public
diff -ru /safe/inf-backup/private /scratch/inf-restore/private
# Expected: both diffs exit 0. Then fold private events with the application
# and compare the exported inventory to the source before replacing anything.
```

## PWA and deployment

The PWA caches a bounded public read experience only. It does not queue offline writes, synchronize in the background, or make private content offline-safe.

Azure deployment is intentionally a later gated step: GitHub `aserdargun/inf-aserdargun-com`, West Europe Free Static Web Apps, with Google secrets supplied as Azure application settings. This milestone explicitly excludes custom-domain, DNS, IHS, certificate, TXT, and CNAME changes.

Task 16 is not yet live. Before it starts, repeat `pnpm validate:codex`, create the public repository, then use Azure CLI placeholders without echoing secret values:

```bash
az group create --name rg-inf-aserdargun-com --location westeurope
az staticwebapp create --name swa-inf-aserdargun-com --resource-group rg-inf-aserdargun-com --location westeurope --sku Free
# Set GOOGLE_* and INF_* secrets through the portal or az staticwebapp appsettings set;
# do not commit them. Deploy the already-verified out/ and api-dist/ artifacts.
az staticwebapp show --name swa-inf-aserdargun-com --resource-group rg-inf-aserdargun-com --query defaultHostname -o tsv
# Substitute the generated host below.
curl -fsSI https://GENERATED.azurestaticapps.net/view
curl -fsS https://GENERATED.azurestaticapps.net/api/public/infographics
az staticwebapp hostname list --name swa-inf-aserdargun-com --resource-group rg-inf-aserdargun-com -o table
# Expected: HTTPS 200, public cache/security headers, public JSON, and an empty hostname list.
```

Do not configure `inf.aserdargun.com`, DNS/IHS/TXT/CNAME records, certificates, or any custom domain in Task 16.
