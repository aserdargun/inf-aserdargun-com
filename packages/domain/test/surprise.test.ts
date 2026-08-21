import { describe, expect, test } from "vitest";
import type { MaterializedInfographic } from "@inf/contracts";
import { selectWeighted, surpriseWeight } from "../src/surprise";

const NOW = "2026-08-20T12:00:00.000Z";

function itemFixture(overrides: Partial<MaterializedInfographic> = {}): MaterializedInfographic {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "CUDA cache diagram",
    notes: null,
    sourceUrl: null,
    sourcePlatform: null,
    sourceAuthor: null,
    originalDriveFileId: "original-1",
    thumbnailDriveFileId: "thumbnail-1",
    sha256: "a".repeat(64),
    detectedMimeType: "image/png",
    width: 1600,
    height: 900,
    favorite: false,
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    capturedAt: "2026-08-06T12:00:00.000Z",
    processedAt: "2026-08-06T12:00:00.000Z",
    lastSeenAt: null,
    seenCount: 0,
    categoryIds: [],
    tagIds: [],
    folderState: "Library",
    reviewCount: 0,
    lastReviewedAt: null,
    reviewDueAt: null,
    ...overrides,
  };
}

describe("surpriseWeight", () => {
  test("uses the specified never-seen formula", () => {
    expect(surpriseWeight(itemFixture(), NOW)).toBe(42);
  });

  test("uses last seen age and review penalties for seen material", () => {
    const item = itemFixture({
      lastSeenAt: "2026-08-15T12:00:00.000Z",
      seenCount: 2,
      reviewCount: 4,
    });

    expect(surpriseWeight(item, NOW)).toBe(5 / 9);
  });

  test("uses UTC whole-day differences and minimum ages for future dates", () => {
    expect(surpriseWeight(itemFixture({ capturedAt: "2026-08-21T00:00:00.000Z" }), NOW)).toBe(28);
    expect(surpriseWeight(itemFixture({ lastSeenAt: "2026-08-21T00:00:00.000Z" }), NOW)).toBe(1);
  });

  test("keeps sub-millisecond precision when flooring elapsed UTC days", () => {
    const item = itemFixture({ lastSeenAt: "2026-08-18T00:00:00.000001Z" });

    expect(surpriseWeight(item, "2026-08-20T00:00:00.000000Z")).toBe(1);
  });

  test("rejects invalid timestamps explicitly", () => {
    expect(() => surpriseWeight(itemFixture({ capturedAt: "not-a-date" }), NOW)).toThrow(RangeError);
    expect(() => surpriseWeight(itemFixture(), "not-a-date")).toThrow(RangeError);
  });
});

describe("selectWeighted", () => {
  test("returns the same selection for identical catalog and seed", () => {
    const items = [
      itemFixture(),
      itemFixture({ id: "22222222-2222-4222-8222-222222222222", lastSeenAt: "2026-08-19T12:00:00.000Z" }),
      itemFixture({ id: "33333333-3333-4333-8333-333333333333", seenCount: 3, reviewCount: 2 }),
    ];

    expect(selectWeighted(items, "2026-08-20:aserdargun:4", NOW)?.id)
      .toBe(selectWeighted(items, "2026-08-20:aserdargun:4", NOW)?.id);
  });

  test("returns null for empty or entirely inactive catalogs and does not mutate input", () => {
    const archived = itemFixture({ archived: true });
    const items = [archived];
    const before = structuredClone(items);

    expect(selectWeighted([], "seed", NOW)).toBeNull();
    expect(selectWeighted(items, "seed", NOW)).toBeNull();
    expect(items).toEqual(before);
  });
});
