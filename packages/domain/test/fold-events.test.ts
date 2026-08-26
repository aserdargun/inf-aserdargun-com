import { describe, expect, test } from "vitest";
import { InfEventSchema } from "@inf/contracts";
import { foldEvents } from "../src/fold-events";

const INFOGRAPHIC_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_CATEGORY_ID = "33333333-3333-4333-8333-333333333333";
const TAG_ID = "44444444-4444-4444-8444-444444444444";
const REVIEW_ID = "55555555-5555-4555-8555-555555555555";

function event(
  type: string,
  eventId: string,
  occurredAt: string,
  payload: unknown,
  infographicId: string | null = INFOGRAPHIC_ID,
) {
  return {
    eventId,
    schemaVersion: 1,
    type,
    occurredAt,
    ...(infographicId === null ? {} : { infographicId }),
    payload,
  };
}

function createdPayload() {
  return {
    originalDriveFileId: "drive-original-1",
    thumbnailDriveFileId: "drive-thumbnail-1",
    sha256: "a".repeat(64),
    detectedMimeType: "image/png",
    width: 1600,
    height: 900,
    title: "CUDA diagram",
    notes: "Private learning note",
    capturedAt: "2026-08-20T09:59:00.000Z",
    createdAt: "2026-08-20T10:00:00.000Z",
    folderState: "Inbox",
  };
}

const CATEGORY = {
  id: CATEGORY_ID,
  displayName: "GPU Computing",
  normalizedName: "gpu computing",
  slug: "gpu-computing",
};

const SECOND_CATEGORY = {
  id: SECOND_CATEGORY_ID,
  displayName: "CUDA",
  normalizedName: "cuda",
  slug: "cuda",
};

const TAG = {
  id: TAG_ID,
  displayName: "Memory",
  normalizedName: "memory",
  slug: "memory",
};

describe("InfEventSchema", () => {
  test("accepts every supported strict event envelope and payload", () => {
    const samples = [
      event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload()),
      event("infographic.metadataUpdated", "00000002-0000-4000-8000-000000000002", "2026-08-20T10:00:01.000Z", { title: "Updated" }),
      event("infographic.categoriesAssigned", "00000003-0000-4000-8000-000000000003", "2026-08-20T10:00:02.000Z", { categories: [CATEGORY] }),
      event("infographic.tagsAssigned", "00000004-0000-4000-8000-000000000004", "2026-08-20T10:00:03.000Z", { tags: [TAG] }),
      event("infographic.favoriteChanged", "00000005-0000-4000-8000-000000000005", "2026-08-20T10:00:04.000Z", { favorite: true }),
      event("infographic.archived", "00000006-0000-4000-8000-000000000006", "2026-08-20T10:00:05.000Z", {}),
      event("infographic.promotedToLibrary", "00000013-0000-4000-8000-000000000013", "2026-08-20T10:00:05.500Z", {}),
      event("infographic.deleted", "00000007-0000-4000-8000-000000000007", "2026-08-20T10:00:06.000Z", {}),
      event("infographic.imageReplaced", "0000000c-0000-4000-8000-00000000000c", "2026-08-20T10:00:06.500Z", {
        previousOriginalDriveFileId: "old-original", previousThumbnailDriveFileId: "old-thumbnail",
        originalDriveFileId: "new-original", thumbnailDriveFileId: "new-thumbnail",
        sha256: "b".repeat(64), detectedMimeType: "image/png", width: 1600, height: 900,
      }),
      event("infographic.seen", "00000008-0000-4000-8000-000000000008", "2026-08-20T10:00:07.000Z", {}),
      event("review.recorded", "00000009-0000-4000-8000-000000000009", "2026-08-20T10:00:08.000Z", {
        reviewId: REVIEW_ID,
        rating: "good",
        reviewedAt: "2026-08-20T10:00:08.000Z",
        previousIntervalDays: null,
        intervalDays: 7,
        dueAt: "2026-08-27T10:00:08.000Z",
      }),
      event("sync.fileRejected", "0000000a-0000-4000-8000-00000000000a", "2026-08-20T10:00:09.000Z", {
        driveFileId: "bad-drive-file",
        fileName: "bad.svg",
        reason: "unsupported image type",
        detectedMimeType: "application/pdf",
      }, null),
    ];

    expect(samples.map((sample) => InfEventSchema.safeParse(sample).success)).toEqual([
      true, true, true, true, true, true, true, true, true, true, true, true,
    ]);
  });

  test("rejects non-UTC timestamps", () => {
    const sample = event(
      "infographic.created",
      "00000001-0000-4000-8000-000000000001",
      "2026-08-20T13:00:00.000+03:00",
      createdPayload(),
    );

    expect(InfEventSchema.safeParse(sample).success).toBe(false);
  });

  test("accepts legacy events with undeclared payload fields and strips them", () => {
    // Pre-refactor events (e.g. those written before `sourceAuthor` and
    // `sourcePlatform` were removed) still appear in the immutable event log.
    // Their payload carries keys the current schema no longer declares, but
    // we must fold them so the affected items re-enter the catalog instead
    // of being quarantined as `invalid-event`.
    const legacy = {
      ...createdPayload(),
      sourceAuthor: "legacy-author",
      sourcePlatform: "legacy-platform",
    };
    const sample = event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", legacy);

    const parsed = InfEventSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // Fold the event and confirm the item materializes with the legacy
    // extra fields dropped, the declared ones intact.
    const result = foldEvents([parsed.data]);
    expect(result.quarantine).toEqual([]);
    expect(result.catalog.infographics).toHaveLength(1);
    expect(result.catalog.infographics[0]).toMatchObject({
      id: INFOGRAPHIC_ID,
      title: "CUDA diagram",
      folderState: "Inbox",
    });
    // The legacy fields must not leak into the materialized item.
    const item = result.catalog.infographics[0] as Record<string, unknown>;
    expect("sourceAuthor" in item).toBe(false);
    expect("sourcePlatform" in item).toBe(false);
  });
});

describe("foldEvents", () => {
  test("sorts reversed input by timestamp and equal timestamps by event ID", () => {
    const at = "2026-08-20T10:00:00.000Z";
    const result = foldEvents([
      event("infographic.metadataUpdated", "30000000-0000-4000-8000-000000000003", at, { title: "Lexically last" }),
      event("infographic.metadataUpdated", "20000000-0000-4000-8000-000000000002", at, { title: "Lexically middle" }),
      event("infographic.created", "10000000-0000-4000-8000-000000000001", at, createdPayload()),
    ]);

    expect(result.catalog.infographics).toHaveLength(1);
    expect(result.catalog.infographics[0]).toMatchObject({
      id: INFOGRAPHIC_ID,
      title: "Lexically last",
      processedAt: null,
      folderState: "Inbox",
    });
  });

  test("orders equivalent UTC ISO precision forms chronologically", () => {
    const result = foldEvents([
      event("infographic.metadataUpdated", "20000000-0000-4000-8000-000000000002", "2026-08-20T10:00:00.100Z", { title: "One tenth later" }),
      event("infographic.created", "10000000-0000-4000-8000-000000000001", "2026-08-20T10:00:00Z", createdPayload()),
    ]);

    expect(result.catalog.infographics[0]?.title).toBe("One tenth later");
    expect(result.quarantine).toEqual([]);
  });

  test("orders UTC instants that differ only beyond millisecond precision", () => {
    const result = foldEvents([
      event("infographic.metadataUpdated", "10000000-0000-4000-8000-000000000001", "2026-08-20T10:00:00.0002Z", { title: "Two ten-thousandths later" }),
      event("infographic.created", "20000000-0000-4000-8000-000000000002", "2026-08-20T10:00:00.0001Z", createdPayload()),
    ]);

    expect(result.catalog.infographics[0]?.title).toBe("Two ten-thousandths later");
    expect(result.quarantine).toEqual([]);
  });

  test("folds metadata, category, tag, favorite, archive, seen, and review mutations", () => {
    const result = foldEvents([
      event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload()),
      event("infographic.metadataUpdated", "00000002-0000-4000-8000-000000000002", "2026-08-20T10:01:00.000Z", {
        title: "Memory coalescing",
        notes: null,
      }),
      event("infographic.categoriesAssigned", "00000003-0000-4000-8000-000000000003", "2026-08-20T10:02:00.000Z", { categories: [CATEGORY] }),
      event("infographic.categoriesAssigned", "00000004-0000-4000-8000-000000000004", "2026-08-20T10:03:00.000Z", { categories: [SECOND_CATEGORY] }),
      event("infographic.tagsAssigned", "00000005-0000-4000-8000-000000000005", "2026-08-20T10:04:00.000Z", { tags: [TAG] }),
      event("infographic.favoriteChanged", "00000006-0000-4000-8000-000000000006", "2026-08-20T10:05:00.000Z", { favorite: true }),
      event("infographic.seen", "00000007-0000-4000-8000-000000000007", "2026-08-20T10:06:00.000Z", {}),
      event("infographic.seen", "00000008-0000-4000-8000-000000000008", "2026-08-20T10:07:00.000Z", {}),
      event("review.recorded", "00000009-0000-4000-8000-000000000009", "2026-08-20T10:08:00.000Z", {
        reviewId: REVIEW_ID,
        rating: "good",
        reviewedAt: "2026-08-20T10:08:00.000Z",
        previousIntervalDays: null,
        intervalDays: 7,
        dueAt: "2026-08-27T10:08:00.000Z",
      }),
      event("infographic.archived", "0000000a-0000-4000-8000-00000000000a", "2026-08-20T10:09:00.000Z", {}),
      event("sync.fileRejected", "0000000b-0000-4000-8000-00000000000b", "2026-08-20T10:10:00.000Z", {
        driveFileId: "bad-drive-file",
        fileName: "bad.svg",
        reason: "unsupported image type",
      }, null),
    ]);

    expect(result.catalog.infographics[0]).toMatchObject({
      title: "Memory coalescing",
      notes: null,
      categoryIds: [SECOND_CATEGORY_ID],
      tagIds: [TAG_ID],
      favorite: true,
      archived: true,
      folderState: "Archive",
      processedAt: "2026-08-20T10:02:00.000Z",
      seenCount: 2,
      lastSeenAt: "2026-08-20T10:07:00.000Z",
      reviewCount: 1,
      lastReviewedAt: "2026-08-20T10:08:00.000Z",
      reviewDueAt: "2026-08-27T10:08:00.000Z",
    });
    expect(result.catalog.categories).toEqual([CATEGORY, SECOND_CATEGORY]);
    expect(result.catalog.tags).toEqual([TAG]);
    expect(result.catalog.reviews).toEqual([expect.objectContaining({
      id: REVIEW_ID,
      infographicId: INFOGRAPHIC_ID,
      rating: "good",
      previousIntervalDays: null,
      intervalDays: 7,
    })]);
    expect(result.catalog.rejectedFiles).toEqual([expect.objectContaining({
      driveFileId: "bad-drive-file",
      reason: "unsupported image type",
    })]);
  });

  test("promotes a stale Inbox item to Library when the backfill event arrives", () => {
    const result = foldEvents([
      event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload()),
      event("infographic.promotedToLibrary", "00000014-0000-4000-8000-000000000014", "2026-08-20T10:30:00.000Z", {}),
    ]);

    expect(result.catalog.infographics[0]).toMatchObject({
      folderState: "Library",
      processedAt: "2026-08-20T10:30:00.000Z",
    });
  });

  test("ignores promotedToLibrary on archived items", () => {
    const result = foldEvents([
      event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload()),
      event("infographic.archived", "00000006-0000-4000-8000-000000000006", "2026-08-20T10:01:00.000Z", {}),
      event("infographic.promotedToLibrary", "00000014-0000-4000-8000-000000000014", "2026-08-20T10:30:00.000Z", {}),
    ]);

    expect(result.catalog.infographics[0]).toMatchObject({
      folderState: "Archive",
      archived: true,
    });
  });

  test("removes deleted items while retaining review history and a rebuildable tombstone", () => {
    const result = foldEvents([
      event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload()),
      event("review.recorded", "00000002-0000-4000-8000-000000000002", "2026-08-20T10:01:00.000Z", {
        reviewId: REVIEW_ID,
        rating: "hard",
        reviewedAt: "2026-08-20T10:01:00.000Z",
        previousIntervalDays: 7,
        intervalDays: 8,
        dueAt: "2026-08-28T10:01:00.000Z",
      }),
      event("infographic.deleted", "00000003-0000-4000-8000-000000000003", "2026-08-20T10:02:00.000Z", {}),
    ]);

    expect(result.catalog.infographics).toEqual([]);
    expect(result.catalog.deletedInfographicIds).toEqual([INFOGRAPHIC_ID]);
    expect(result.catalog.reviews).toEqual([expect.objectContaining({ id: REVIEW_ID })]);
  });

  test("keeps an archived item in Archive when its first category arrives later", () => {
    const result = foldEvents([
      event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload()),
      event("infographic.archived", "00000002-0000-4000-8000-000000000002", "2026-08-20T10:01:00.000Z", {}),
      event("infographic.categoriesAssigned", "00000003-0000-4000-8000-000000000003", "2026-08-20T10:02:00.000Z", { categories: [CATEGORY] }),
    ]);

    expect(result.catalog.infographics[0]).toMatchObject({
      archived: true,
      folderState: "Archive",
      processedAt: "2026-08-20T10:02:00.000Z",
    });
  });

  test("quarantines invalid, unknown-version, duplicate, and orphan events without blocking valid folds", () => {
    const created = event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload());
    const result = foldEvents([
      { malformed: true },
      { ...created, eventId: "00000002-0000-4000-8000-000000000002", schemaVersion: 99 },
      created,
      event("infographic.favoriteChanged", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:01:00.000Z", { favorite: true }),
      event("infographic.tagsAssigned", "00000003-0000-4000-8000-000000000003", "2026-08-20T10:02:00.000Z", { tags: [TAG] }, "99999999-9999-4999-8999-999999999999"),
      event("infographic.metadataUpdated", "00000004-0000-4000-8000-000000000004", "2026-08-20T10:03:00.000Z", { title: "Still folded" }),
    ]);

    expect(result.catalog.infographics).toEqual([expect.objectContaining({
      title: "Still folded",
      favorite: false,
    })]);
    expect(result.quarantine).toHaveLength(4);
    expect(result.quarantine.map(({ reason }) => reason)).toEqual([
      "invalid-event",
      "unknown-schema-version",
      "duplicate-event-id",
      "orphan-event",
    ]);
  });

  test("does not mutate the caller's array or event objects", () => {
    const input = [
      event("infographic.metadataUpdated", "00000002-0000-4000-8000-000000000002", "2026-08-20T10:01:00.000Z", { title: "Updated" }),
      event("infographic.created", "00000001-0000-4000-8000-000000000001", "2026-08-20T10:00:00.000Z", createdPayload()),
    ];
    const before = structuredClone(input);

    foldEvents(input);

    expect(input).toEqual(before);
  });
});
