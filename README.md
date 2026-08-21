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

Task 15 is not yet live. Its operator procedure is: create a Google Cloud Desktop OAuth client, enable Drive API, configure consent for the owner, authorize the minimum Drive read/write scope needed to list the public root and its children, obtain a refresh token without printing it, then provision and read back `Inbox`, `Library`, `Archive`, `Duplicates`, `Thumbnails`, and restricted sibling `INF-PRIVATE-DATA/{events,reviews,quarantine,exports}`. Confirm only the public root is `anyone: reader`; private roots must have no public/domain grants. Save only IDs and secrets in `.env.local` mode 0600.

## PWA and deployment

The PWA caches a bounded public read experience only. It does not queue offline writes, synchronize in the background, or make private content offline-safe.

Azure deployment is intentionally a later gated step: GitHub `aserdargun/inf-aserdargun-com`, West Europe Free Static Web Apps, with Google secrets supplied as Azure application settings. This milestone explicitly excludes custom-domain, DNS, IHS, certificate, TXT, and CNAME changes.

Task 16 is not yet live. Before it starts, repeat `pnpm validate:codex`, create the public repository, provision `rg-inf-aserdargun-com` and `swa-inf-aserdargun-com` in West Europe Free, set only named application settings/secrets, deploy prebuilt `out/` and `api-dist/`, and verify the generated `*.azurestaticapps.net` host, public View, owner login, headers, asset types, and empty custom-domain list. Do not configure `inf.aserdargun.com`.
