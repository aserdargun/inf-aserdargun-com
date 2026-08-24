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

  constructor(private readonly inner: EventStore, options: CachedEventStoreOptions) {
    if (options.readAllTtlMs <= 0) throw new Error("CachedEventStore TTL must be positive.");
    this.cache = new LruCache<unknown[]>({ maxEntries: options.maxEntries, defaultTtlMs: options.readAllTtlMs });
  }

  async readAll(): Promise<unknown[]> {
    const cached = this.cache.get("events:all");
    if (cached) return cached;
    const value = await this.inner.readAll();
    this.cache.set("events:all", value);
    return value;
  }

  async append(input: InfEvent): Promise<void> {
    await this.inner.append(input);
    this.cache.delete("events:all");
  }

  describe(): { hits: number; misses: number; size: number } {
    return { hits: this.cache.hits, misses: this.cache.misses, size: this.cache.size };
  }
}
