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
  test("caches readAll within TTL", async () => {
    const inner = new FakeEventStore();
    inner.setNext([sampleEvent]);
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1 });
    const first = await store.readAll();
    const second = await store.readAll();
    expect(first).toBe(second);
    expect(inner.readAllCalls).toBe(1);
  });

  test("append invalidates the cache", async () => {
    const inner = new FakeEventStore();
    inner.setNext([sampleEvent]);
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 1_000, maxEntries: 1 });
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
    const store = new CachedEventStore(inner as never, { readAllTtlMs: 30, maxEntries: 1 });
    await store.readAll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    inner.setNext([sampleEvent, sampleEvent]);
    const after = await store.readAll();
    expect(after).toEqual([sampleEvent, sampleEvent]);
    expect(inner.readAllCalls).toBe(2);
  });

  test("rejects non-positive TTL", () => {
    const inner = new FakeEventStore();
    expect(() => new CachedEventStore(inner as never, { readAllTtlMs: 0, maxEntries: 1 })).toThrow();
  });
});
