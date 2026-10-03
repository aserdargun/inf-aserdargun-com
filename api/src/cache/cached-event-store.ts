import type { InfEvent } from "@inf/contracts";
import { LruCache } from "./lru-cache.js";
import type { EventStore } from "../storage/event-store.js";

export interface CachedEventStoreOptions {
  /** TTL for the folded event list; brief because every write must surface quickly. */
  readonly readAllTtlMs: number;
  /** LRU cap; the event list can grow but is bounded by the catalog's lifetime. */
  readonly maxEntries: number;
  /**
   * How long a last-known-good snapshot may still be served after a refresh
   * fails. Bounds how far the public gallery may drift while Drive is degraded.
   */
  readonly maxStaleMs: number;
  /** Optional monotonic clock for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Read-through cache for `EventStore.readAll`. The fold is pure but expensive
 * (every list-and-parse cycle costs N Drive `files.list` and N `readFile` calls).
 * A short TTL keeps a single public-page render consistent while sparing repeat
 * reads within the same page load and across concurrent viewers.
 *
 * The read is also shared: concurrent misses join one in-flight `readAll`. That
 * makes a single Drive failure fail every concurrent reader at once, so a failed
 * refresh degrades to the last-known-good snapshot instead of propagating. Only
 * a failure with no usable fallback is allowed to surface.
 */
export class CachedEventStore implements Pick<EventStore, "readAll" | "append"> {
  private readonly cache: LruCache<unknown[]>;
  private readonly maxStaleMs: number;
  private readonly now: () => number;
  private pendingRead: Promise<unknown[]> | null = null;
  private lastGood: { value: unknown[]; at: number } | null = null;
  private revision = 0;

  constructor(private readonly inner: EventStore, options: CachedEventStoreOptions) {
    if (options.readAllTtlMs <= 0) throw new Error("CachedEventStore TTL must be positive.");
    if (options.maxStaleMs < 0) throw new Error("CachedEventStore maxStaleMs must not be negative.");
    this.now = options.now ?? (() => Date.now());
    // The cache and the stale window must age against the same clock, otherwise
    // an injected clock would expire one and not the other.
    this.cache = new LruCache<unknown[]>({ maxEntries: options.maxEntries, defaultTtlMs: options.readAllTtlMs, now: this.now });
    this.maxStaleMs = options.maxStaleMs;
  }

  async readAll(): Promise<unknown[]> {
    const cached = this.cache.get("events:all");
    if (cached) return cached;
    if (this.pendingRead) return this.pendingRead;
    const revision = this.revision;
    const pending = this.inner.readAll().then((value) => {
      // A read that started before a write must not repopulate the fallback either,
      // or a later failed read could hand a writer their own pre-write state.
      if (revision === this.revision) {
        this.lastGood = { value, at: this.now() };
        this.cache.set("events:all", value);
      }
      return value;
    }).catch((error: unknown) => {
      // Serve the last known-good fold rather than failing every concurrent
      // reader. The failed read is deliberately not cached, so the next request
      // retries and recovers as soon as Drive does.
      const stale = this.lastGood;
      if (stale === null || this.now() - stale.at >= this.maxStaleMs) throw error;
      return stale.value;
    }).finally(() => {
      if (this.pendingRead === pending) this.pendingRead = null;
    });
    this.pendingRead = pending;
    return pending;
  }

  async append(input: InfEvent): Promise<void> {
    this.invalidate();
    try { await this.inner.append(input); }
    finally { this.invalidate(); }
  }

  private invalidate(): void {
    this.revision += 1;
    this.cache.delete("events:all");
    // A read started before or during the write cannot satisfy a later read.
    this.pendingRead = null;
    // The fallback is dropped with the cache: a writer must never have their own
    // write silently masked by pre-write state, so a post-write read that cannot
    // reach Drive fails loudly instead.
    this.lastGood = null;
  }

  describe(): { hits: number; misses: number; size: number } {
    return { hits: this.cache.hits, misses: this.cache.misses, size: this.cache.size };
  }
}
