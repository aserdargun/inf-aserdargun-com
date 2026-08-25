import { describe, expect, test } from "vitest";
import type { Category, MaterializedInfographic, Tag } from "@inf/contracts";
import { searchCatalog } from "../src/search";

const CATEGORY: Category = {
  id: "22222222-2222-4222-8222-222222222222",
  displayName: "Visual Computing",
  normalizedName: "graphics systems",
  slug: "visual-computing",
};

const TAG: Tag = {
  id: "33333333-3333-4333-8333-333333333333",
  displayName: "GPU Memory",
  normalizedName: "memory hierarchy",
  slug: "gpu-memory",
};

function itemFixture(): MaterializedInfographic {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "CUDA cache diagram",
    notes: "Coalesced kernel access reduces stalls.",
    originalDriveFileId: "original-1",
    thumbnailDriveFileId: "thumbnail-1",
    sha256: "a".repeat(64),
    detectedMimeType: "image/png",
    width: 1600,
    height: 900,
    favorite: false,
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    capturedAt: "2026-08-01T00:00:00.000Z",
    processedAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: null,
    seenCount: 0,
    categoryIds: [CATEGORY.id],
    tagIds: [TAG.id],
    folderState: "Library",
    reviewCount: 0,
    lastReviewedAt: null,
    reviewDueAt: null,
  };
}

const taxonomy = { categories: [CATEGORY], tags: [TAG] };

describe("searchCatalog", () => {
  test.each([
    ["title", "cuda"],
    ["notes", "coalesced kernel"],
    ["resolved tag display name", "gpu memory"],
    ["resolved tag normalized name", "memory hierarchy"],
    ["resolved category display name", "visual computing"],
    ["resolved category normalized name", "graphics systems"],
  ])("matches normalized %s", (_field, query) => {
    expect(searchCatalog([itemFixture()], query, taxonomy)).toEqual([itemFixture()]);
  });

  test("normalizes Unicode case and whitespace without using taxonomy IDs as labels", () => {
    const item = itemFixture();

    expect(searchCatalog([item], "  CUDA   CACHE  ")).toEqual([item]);
    expect(searchCatalog([item], CATEGORY.id, taxonomy)).toEqual([]);
  });

  test("returns all items for an empty query and does not mutate the catalog", () => {
    const items = [itemFixture()];
    const before = structuredClone(items);

    expect(searchCatalog(items, "   ", taxonomy)).toEqual(items);
    expect(searchCatalog(items, "missing", taxonomy)).toEqual([]);
    expect(items).toEqual(before);
  });
});
