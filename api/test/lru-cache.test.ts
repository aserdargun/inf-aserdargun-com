import { describe, expect, test } from "vitest";
import { LruCache } from "../src/cache/lru-cache.js";

describe("LruCache", () => {
  test("returns undefined for missing keys and tracks misses", () => {
    const cache = new LruCache<string>({ maxEntries: 4, defaultTtlMs: 1_000 });
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.misses).toBe(1);
    expect(cache.hits).toBe(0);
  });

  test("returns stored values and tracks hits", () => {
    let now = 0;
    const cache = new LruCache<string>({ maxEntries: 4, defaultTtlMs: 1_000, now: () => now });
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(0);
  });

  test("expires entries after TTL", () => {
    let now = 0;
    const cache = new LruCache<string>({ maxEntries: 4, defaultTtlMs: 1_000, now: () => now });
    cache.set("k", "v");
    now = 999;
    expect(cache.get("k")).toBe("v");
    now = 1_000;
    expect(cache.get("k")).toBeUndefined();
  });

  test("uses per-entry TTL when provided", () => {
    let now = 0;
    const cache = new LruCache<string>({ maxEntries: 4, defaultTtlMs: 1_000, now: () => now });
    cache.set("short", "v", 100);
    now = 99;
    expect(cache.get("short")).toBe("v");
    now = 100;
    expect(cache.get("short")).toBeUndefined();
  });

  test("evicts least-recently-used entry when over capacity", () => {
    let now = 0;
    const cache = new LruCache<string>({ maxEntries: 2, defaultTtlMs: 10_000, now: () => now });
    cache.set("a", "1");
    now = 1; cache.set("b", "2");
    now = 2; cache.get("a");
    now = 3; cache.set("c", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
  });

  test("delete removes the entry", () => {
    const cache = new LruCache<string>({ maxEntries: 4, defaultTtlMs: 1_000 });
    cache.set("k", "v");
    expect(cache.delete("k")).toBe(true);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.delete("k")).toBe(false);
  });

  test("invalidateWhere removes only matching keys", () => {
    const cache = new LruCache<string>({ maxEntries: 4, defaultTtlMs: 1_000 });
    cache.set("desc:public:file-a", "true");
    cache.set("desc:public:file-b", "true");
    cache.set("file:a", "bytes-a");
    const removed = cache.invalidateWhere((key) => key.startsWith("desc:public:file-a"));
    expect(removed).toBe(1);
    expect(cache.get("desc:public:file-a")).toBeUndefined();
    expect(cache.get("desc:public:file-b")).toBe("true");
    expect(cache.get("file:a")).toBe("bytes-a");
  });

  test("rejects non-positive configuration", () => {
    expect(() => new LruCache<string>({ maxEntries: 0, defaultTtlMs: 1_000 })).toThrow();
    expect(() => new LruCache<string>({ maxEntries: 1, defaultTtlMs: 0 })).toThrow();
  });
});
