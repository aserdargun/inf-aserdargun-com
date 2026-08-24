export { LruCache, type LruCacheOptions } from "./lru-cache.js";
export { CachedStorage, type CachedStorageOptions } from "./cached-storage.js";
export { CachedEventStore, type CachedEventStoreOptions } from "./cached-event-store.js";

/**
 * Centralized cache TTLs and caps. The values are intentionally conservative:
 *   - `descentTtlMs=60s` absorbs a single page load across all gallery items.
 *   - `fileTtlMs=300s` is well under any realistic ingest cadence; mutations
 *      invalidate the affected keys synchronously, so a freshly-captured item
 *      becomes visible within one read.
 *   - `readAllTtlMs=30s` keeps a public render consistent while a writer sees
 *      their own change on the next request.
 */
export const DEFAULT_CACHE_TTLS = {
  storage: { descentTtlMs: 60_000, fileTtlMs: 300_000, descentMaxEntries: 4_096, fileMaxEntries: 1_024 },
  events: { readAllTtlMs: 30_000, maxEntries: 1 },
} as const;
