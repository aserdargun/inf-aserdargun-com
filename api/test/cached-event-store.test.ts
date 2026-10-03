import { describe, expect, test } from "vitest";
import { CachedEventStore } from "../src/cache/cached-event-store.js";
import type { InfEvent } from "@inf/contracts";

class FakeEventStore {
  readAllCalls = 0;
  appendCalls: InfEvent[] = [];
  private nextEvents: unknown[][] = [];

  setNext(events: unknown[]): void { this.nextEvents.push(events); }

  async readAll(): Promise<unknown[]> {
    this.readAllCalls += 1;
    if (this.nextEvents.length === 0) return [];
    return this.nextEvents.shift()!;
  }

  async append(input: InfEvent): Promise<void> {
    this.appendCalls.push(input);
  }
}

const sampleEvent = {
  eventId: "evt-1", schemaVersion: 1 as const, type: "infographic.created" as const, occurredAt: "2026-01-01T00:00:00.000Z",
  infographicId: "inf-1", payload: { title: "t" },
} as unknown as InfEvent;

describe("CachedEventStore", () => {
  test("coalesces concurrent cache misses into one Drive read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inner = new FakeEventStore();
    inner.setNext([sampleEvent]);
    const originalRead = inner.readAll.bind(inner);
    inner.readAll = async () => { await gate; return originalRead(); };
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: 300_000 });

    const first = store.readAll();
    const second = store.readAll();
    release();

    expect(await first).toEqual([sampleEvent]);
    expect(await second).toEqual([sampleEvent]);
    expect(inner.readAllCalls).toBe(1);
  });

  test("caches readAll within TTL", async () => {
    const inner = new FakeEventStore();
    inner.setNext([sampleEvent]);
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: 300_000 });
    const first = await store.readAll();
    const second = await store.readAll();
    expect(first).toBe(second);
    expect(inner.readAllCalls).toBe(1);
  });

  test("append invalidates the cache", async () => {
    const inner = new FakeEventStore();
    inner.setNext([sampleEvent]);
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: 300_000 });
    await store.readAll();
    await store.append(sampleEvent);
    inner.setNext([sampleEvent, sampleEvent]);
    const after = await store.readAll();
    expect(after).toEqual([sampleEvent, sampleEvent]);
    expect(inner.readAllCalls).toBe(2);
  });

  test("expired entries trigger a fresh read", async () => {
    const inner = new FakeEventStore();
    inner.setNext([sampleEvent]);
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 30, maxEntries: 1, maxStaleMs: 300_000 });
    await store.readAll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    inner.setNext([sampleEvent, sampleEvent]);
    const after = await store.readAll();
    expect(after).toEqual([sampleEvent, sampleEvent]);
    expect(inner.readAllCalls).toBe(2);
  });

  test("rejects non-positive TTL", () => {
    const inner = new FakeEventStore();
    expect(() => new CachedEventStore(inner as never, { readAllTtlMs: 0, maxEntries: 1, maxStaleMs: 300_000 })).toThrow();
  });

  test("rejects a negative max stale window", () => {
    const inner = new FakeEventStore();
    expect(() => new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: -1 })).toThrow();
  });
});


test("post-write reads neither join nor cache an older in-flight snapshot", async () => {
  let release!: (events: unknown[]) => void;
  const inner = new FakeEventStore();
  const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: 300_000 });
  inner.readAll = () => new Promise((resolve) => { release = resolve; });
  const old = store.readAll();
  await store.append(sampleEvent);
  inner.readAll = async () => [sampleEvent];
  expect(await store.readAll()).toEqual([sampleEvent]);
  release([]);
  await old;
  expect(await store.readAll()).toEqual([sampleEvent]);
});

test("invalidates snapshots populated while a write was in progress", async () => {
  let finish!: () => void;
  const inner = new FakeEventStore();
  inner.append = () => new Promise<void>((resolve) => { finish = resolve; });
  const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: 300_000 });
  const writing = store.append(sampleEvent);
  expect(await store.readAll()).toEqual([]);
  finish(); await writing;
  inner.setNext([sampleEvent]);
  expect(await store.readAll()).toEqual([sampleEvent]);
});

describe("stale-while-revalidate", () => {
  class FlakyEventStore extends FakeEventStore {
    failNext = false;
    override async readAll(): Promise<unknown[]> {
      if (this.failNext) throw new Error("drive rate limit");
      return super.readAll();
    }
  }

  /** Injected clock: the cache TTL and the stale window both age against `clock`. */
  function harness(maxStaleMs = 100) {
    const clock = { at: 0 };
    const inner = new FlakyEventStore();
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 50, maxEntries: 1, maxStaleMs, now: () => clock.at });
    return { inner, store, clock };
  }

  test("serves the last known-good snapshot when a refresh fails, then recovers", async () => {
    const { inner, store, clock } = harness();
    inner.setNext([sampleEvent]);
    expect(await store.readAll()).toEqual([sampleEvent]);

    clock.at = 51;
    inner.failNext = true;
    expect(await store.readAll()).toEqual([sampleEvent]);

    // The failed refresh is not cached, so the next read retries and picks up new state.
    inner.failNext = false;
    inner.setNext([sampleEvent, sampleEvent]);
    expect(await store.readAll()).toEqual([sampleEvent, sampleEvent]);
  });

  test("a failed refresh does not fail the readers already sharing the in-flight read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { inner, store, clock } = harness();
    inner.setNext([sampleEvent]);
    expect(await store.readAll()).toEqual([sampleEvent]);

    clock.at = 51;
    inner.failNext = true;
    const originalRead = inner.readAll.bind(inner);
    inner.readAll = async () => { await gate; return originalRead(); };
    const first = store.readAll();
    const second = store.readAll();
    release();

    // A single Drive rate-limit window must not 500 every concurrent reader.
    expect(await first).toEqual([sampleEvent]);
    expect(await second).toEqual([sampleEvent]);
  });

  test("propagates the failure when there is no snapshot to fall back on", async () => {
    const inner = new FlakyEventStore();
    inner.failNext = true;
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: 300_000 });
    await expect(store.readAll()).rejects.toThrow("drive rate limit");
  });

  test("stops falling back once the snapshot is older than the stale window", async () => {
    const { inner, store, clock } = harness(100);
    inner.setNext([sampleEvent]);
    expect(await store.readAll()).toEqual([sampleEvent]);

    clock.at = 99;
    inner.failNext = true;
    expect(await store.readAll()).toEqual([sampleEvent]);

    clock.at = 100;
    await expect(store.readAll()).rejects.toThrow("drive rate limit");
  });

  test("a write drops the fallback so a failed post-write read fails loudly", async () => {
    const { inner, store } = harness();
    inner.setNext([sampleEvent]);
    expect(await store.readAll()).toEqual([sampleEvent]);

    await store.append(sampleEvent);
    inner.failNext = true;
    // Silently serving pre-write state would hide the owner's own capture.
    await expect(store.readAll()).rejects.toThrow("drive rate limit");
  });

  test("a zero stale window keeps the failure visible", async () => {
    const { inner, store, clock } = harness(0);
    inner.setNext([sampleEvent]);
    expect(await store.readAll()).toEqual([sampleEvent]);

    clock.at = 51;
    inner.failNext = true;
    await expect(store.readAll()).rejects.toThrow("drive rate limit");
  });

  test("a read that resolves after a write does not repopulate the fallback with pre-write state", async () => {
    let release!: (events: unknown[]) => void;
    const inner = new FlakyEventStore();
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1, maxStaleMs: 300_000 });
    const originalRead = inner.readAll.bind(inner);
    inner.readAll = () => new Promise((resolve) => { release = resolve; });
    const inFlight = store.readAll();

    await store.append(sampleEvent);
    release([sampleEvent]);
    await inFlight;

    inner.readAll = originalRead;
    inner.failNext = true;
    await expect(store.readAll()).rejects.toThrow("drive rate limit");
  });
});
