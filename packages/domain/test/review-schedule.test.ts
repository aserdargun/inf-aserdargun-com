import { describe, expect, test } from "vitest";
import { UtcDateTimeSchema, type MaterializedInfographic, type ReviewRating } from "@inf/contracts";
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

  test("preserves accepted sub-millisecond precision when deriving dueAt", () => {
    expect(scheduleReview("again", null, "2026-08-20T10:30:00.123456Z")).toEqual({
      intervalDays: 1,
      dueAt: "2026-08-21T10:30:00.123456Z",
    });
  });

  test("does not return a dueAt outside the UTC timestamp contract when year 9999 overflows", () => {
    const reviewedAt = "9999-12-31T23:59:59.999999Z";
    expect(UtcDateTimeSchema.safeParse(reviewedAt).success).toBe(true);

    expect(() => scheduleReview("easy", null, reviewedAt)).toThrow(RangeError);
  });

  test("keeps an in-range year-9999 dueAt schema-valid", () => {
    const scheduled = scheduleReview("easy", null, "9999-12-17T23:59:59.999999Z");

    expect(scheduled.dueAt).toBe("9999-12-31T23:59:59.999999Z");
    expect(UtcDateTimeSchema.safeParse(scheduled.dueAt).success).toBe(true);
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

  test("orders due instants that differ only beyond millisecond precision before review and ID ties", () => {
    const earliestDue = itemFixture({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      reviewDueAt: "2026-08-20T00:00:00.000001Z",
      lastReviewedAt: "2026-08-19T00:00:00.000Z",
    });
    const laterDue = itemFixture({
      id: "00000000-0000-4000-8000-000000000000",
      reviewDueAt: "2026-08-20T00:00:00.000002Z",
      lastReviewedAt: "2026-08-18T00:00:00.000Z",
    });

    expect(sortDueItems([laterDue, earliestDue]).map(({ id }) => id)).toEqual([
      earliestDue.id,
      laterDue.id,
    ]);
  });
});
