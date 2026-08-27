import type { MaterializedInfographic } from "@inf/contracts";
import { describe, expect, test } from "vitest";
import { formatDueTiming, recentInfographics, reviewNextInfographics } from "../lib/today-data";

function item(overrides: Partial<MaterializedInfographic>): MaterializedInfographic {
  return { id: "00000000-0000-4000-8000-000000000001", title: "Diagram", notes: null, originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 1600, height: 400, favorite: false, archived: false, createdAt: "2026-08-20T10:00:00.000Z", capturedAt: "2026-08-20T10:00:00.000Z", processedAt: null, lastSeenAt: null, seenCount: 0, categoryIds: [], tagIds: [], folderState: "Library", reviewCount: 0, lastReviewedAt: null, reviewDueAt: null, ...overrides };
}

describe("Today data", () => {
  test("sorts recent capture and review due instants exactly while omitting archived review items", () => {
    const items = [item({ id: "00000000-0000-4000-8000-000000000001", title: "middle", capturedAt: "2026-08-20T10:00:00.1Z", reviewDueAt: "2026-08-24T10:00:00.000002Z" }), item({ id: "00000000-0000-4000-8000-000000000002", title: "newest", capturedAt: "2026-08-20T10:00:00.2Z", reviewDueAt: "2026-08-24T10:00:00.000001Z" }), item({ id: "00000000-0000-4000-8000-000000000003", title: "archived", archived: true, capturedAt: "2026-08-20T10:00:00.3Z", reviewDueAt: "2026-08-20T10:00:00.000000Z" })];
    expect(recentInfographics(items).map((entry) => entry.title)).toEqual(["newest", "middle"]);
    expect(reviewNextInfographics(items).map((entry) => entry.title)).toEqual(["newest", "middle"]);
  });

  test("uses calendar-accurate due timing", () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    expect(formatDueTiming("2026-08-21T12:00:00.000Z", now)).toBe("Due in 2 hours");
    expect(formatDueTiming("2026-08-22T09:00:00.000Z", now)).toBe("Due tomorrow");
    expect(formatDueTiming("2026-08-23T09:00:00.000Z", now)).toBe("Due in 2 days");
  });
});
