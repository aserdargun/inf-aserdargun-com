import { describe, expect, test } from "vitest";
import type { MaterializedInfographic, ReviewRating } from "@inf/contracts";
import { scheduleReview, sortDueItems } from "../src/review-schedule";

const REVIEWED_AT = "2026-08-20T10:30:00.000Z";

function itemFixture(overrides: Partial<MaterializedInfographic>): MaterializedInfographic {
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
    capturedAt: "2026-08-01T00:00:00.000Z",
    processedAt: "2026-08-01T00:00:00.000Z",
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

describe("scheduleReview", () => {
  test.each<[ReviewRating, number | null, number]>([
    ["again", null, 1], ["hard", null, 3], ["good", null, 7], ["easy", null, 14],
    ["again", 14, 1], ["hard", 10, 12], ["good", 10, 20], ["easy", 10, 30],
  ])("schedules %s from %s previous days as %s days", (rating, previous, intervalDays) => {
    expect(scheduleReview(rating, previous, REVIEWED_AT).intervalDays).toBe(intervalDays);
  });

  test.each<[ReviewRating, number, number]>([
    ["hard", 1, 2], ["good", 1, 4], ["easy", 1, 7],
  ])("keeps the %s subsequent interval at its minimum", (rating, previous, intervalDays) => {
    expect(scheduleReview(rating, previous, REVIEWED_AT).intervalDays).toBe(intervalDays);
  });

  test("derives dueAt by adding whole UTC days to reviewedAt", () => {
    expect(scheduleReview("good", null, "2024-02-28T23:30:00.000Z")).toEqual({
      intervalDays: 7,
      dueAt: "2024-03-06T23:30:00.000Z",
    });
  });
});

describe("sortDueItems", () => {
  test("orders due items by dueAt, least recently reviewed, then infographic ID without mutation", () => {
    const items = [
      itemFixture({ id: "33333333-3333-4333-8333-333333333333", reviewDueAt: "2026-08-21T00:00:00.000Z", lastReviewedAt: "2026-08-10T00:00:00.000Z" }),
      itemFixture({ id: "22222222-2222-4222-8222-222222222222", reviewDueAt: "2026-08-20T00:00:00.000Z", lastReviewedAt: "2026-08-19T00:00:00.000Z" }),
      itemFixture({ id: "11111111-1111-4111-8111-111111111111", reviewDueAt: "2026-08-20T00:00:00.000Z", lastReviewedAt: "2026-08-18T00:00:00.000Z" }),
      itemFixture({ id: "00000000-0000-4000-8000-000000000000", reviewDueAt: "2026-08-20T00:00:00.000Z", lastReviewedAt: "2026-08-18T00:00:00.000Z" }),
      itemFixture({ id: "44444444-4444-4444-8444-444444444444", reviewDueAt: null }),
    ];
    const before = structuredClone(items);

    expect(sortDueItems(items).map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000000",
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(items).toEqual(before);
  });
});
