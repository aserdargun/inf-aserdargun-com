# Architecture

The statically exported Next.js client is served by Azure Static Web Apps. Managed Node 22 Functions own all Drive and learning mutations. The browser has no Google credential and never accesses private Drive data directly.

Public `/view*` requests use explicit allowlisted projections. Owner APIs independently verify GitHub `aserdargun`; SWA route roles are a second boundary. Private learning state is append-only schema-versioned JSON events in a restricted Drive sibling, folded deterministically by occurrence time and event ID. Public originals and thumbnails remain under the approved public Drive root.

For local release validation only, `INF_LOCAL_STORAGE_MODE=true` selects `LocalDriveAdapter` iff bypass is exact, `WEBSITE_SITE_NAME` is absent, the request is loopback, and a per-run server-side capability matches. Any failed gate falls back to the normal Google configuration requirement. A checkout-owned Node adapter binds `127.0.0.1:7071` and invokes the compiled Azure Function handlers with the same Request/response contract; deployment continues to use Azure's managed Functions runtime. The SWA emulator on 4280 talks to a loopback API proxy on 7072; that proxy injects the secret capability before forwarding to 7071. Browser assets, local storage, and control output never contain the capability.

Local publication first moves the exact source data and sidecar into a unique checkout-private `.operations/<uuid>/` claim. All later cleanup is confined to that unpredictable operation directory. A fault restores both source names only when both are absent; foreign source replacements are preserved and the original operation is retained as explicit quarantine. Caller-visible source or destination names are never unlinked during rollback.

`pnpm preview:codex` changes only the web child to the immutable `out/` server. Compiled Functions, private capability proxy, SWA emulator, auth gates, local storage, and bounded Stop behavior are the same as normal Run, making it the deterministic production-artifact visual and release-evidence path.
