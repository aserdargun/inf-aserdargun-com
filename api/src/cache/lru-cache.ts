/**
 * Bounded TTL+LRU cache. Designed for in-process request hot paths where freshness
 * can be traded for latency, never for correctness. The cache is single-process and
 * not shared across Functions instances; that is acceptable because every entry
 * has an expiry well under the SWA cold-start window.
 */
export interface LruCacheOptions {
  /** Maximum number of entries before least-recently-used eviction. */
  readonly maxEntries: number;
  /** Default per-entry time-to-live in milliseconds. */
  readonly defaultTtlMs: number;
  /** Optional monotonic clock for deterministic tests. */
  readonly now?: () => number;
}

interface Entry<V> {
  value: V;
  /** Absolute expiry timestamp in milliseconds (clock-units returned by `now`). */
  expiresAt: number;
  /** Last accessed timestamp in milliseconds, used for LRU ordering. */
  touchedAt: number;
}

export class LruCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  /** Tracks hit/miss counts for tests and operational diagnostics. */
  public hits = 0;
  public misses = 0;

  constructor(options: LruCacheOptions) {
    if (options.maxEntries <= 0) throw new Error("LruCache maxEntries must be positive.");
    if (options.defaultTtlMs <= 0) throw new Error("LruCache defaultTtlMs must be positive.");
    this.maxEntries = options.maxEntries;
    this.defaultTtlMs = options.defaultTtlMs;
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) { this.misses += 1; return undefined; }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    entry.touchedAt = this.now();
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number = this.defaultTtlMs): void {
    if (ttlMs <= 0) throw new Error("LruCache ttlMs must be positive.");
    const now = this.now();
    this.entries.set(key, { value, expiresAt: now + ttlMs, touchedAt: now });
    this.evictIfOverCapacity();
  }

  delete(key: string): boolean { return this.entries.delete(key); }

  clear(): void { this.entries.clear(); }

  get size(): number { return this.entries.size; }

  /** Remove all entries that match the predicate; used for selective invalidation. */
  invalidateWhere(predicate: (key: string) => boolean): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (predicate(key)) { this.entries.delete(key); removed += 1; }
    }
    return removed;
  }

  private evictIfOverCapacity(): void {
    if (this.entries.size <= this.maxEntries) return;
    let oldestKey: string | undefined;
    let oldestTouched = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.touchedAt < oldestTouched) { oldestTouched = entry.touchedAt; oldestKey = key; }
    }
    if (oldestKey !== undefined) this.entries.delete(oldestKey);
  }
}
