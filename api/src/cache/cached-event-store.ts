import type { InfEvent } from "@inf/contracts";
import { LruCache } from "./lru-cache.js";
import type { EventStore } from "../storage/event-store.js";

export interface CachedEventStoreOptions {
  /** TTL for the folded event list; brief because every write must surface quickly. */
  readonly readAllTtlMs: number;
  /** LRU cap; the event list can grow but is bounded by the catalog's lifetime. */
  readonly maxEntries: number;
}

/**
 * Read-through cache for `EventStore.readAll`. The fold is pure but expensive
 * (every list-and-parse cycle costs N Drive `files.list` and N `readFile` calls).
 * A short TTL keeps a single public-page render consistent while sparing repeat
 * reads within the same page load and across concurrent viewers.
 */
export class CachedEventStore implements Pick<EventStore, "readAll" | "append"> {
  private readonly cache: LruCache<unknown[]>;
  private pendingRead: Promise<unknown[]> | null = null;
  private revision = 0;

  constructor(private readonly inner: EventStore, options: CachedEventStoreOptions) {
    if (options.readAllTtlMs <= 0) throw new Error("CachedEventStore TTL must be positive.");
    this.cache = new LruCache<unknown[]>({ maxEntries: options.maxEntries, defaultTtlMs: options.readAllTtlMs });
  }

  async readAll(): Promise<unknown[]> {
    const cached = this.cache.get("events:all");
    if (cached) return cached;
    if (this.pendingRead) return this.pendingRead;
    const revision = this.revision;
    const pending = this.inner.readAll().then((value) => {
      if (revision === this.revision) this.cache.set("events:all", value);
      return value;
    }).finally(() => {
      if (this.pendingRead === pending) this.pendingRead = null;
    });
    this.pendingRead = pending;
    return pending;
  }

  async append(input: InfEvent): Promise<void> {
    this.revision += 1;
    this.cache.delete("events:all");
    await this.inner.append(input);
  }

  describe(): { hits: number; misses: number; size: number } {
    return { hits: this.cache.hits, misses: this.cache.misses, size: this.cache.size };
  }
}
