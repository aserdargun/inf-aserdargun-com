import { expect, test } from "vitest";
import { PublicInfographicSchema, type MaterializedInfographic } from "@inf/contracts";
import { toPublicInfographic } from "../src/http/public-projection.js";

const capturedAt = "2026-08-20T12:34:56.000Z";
const privateFixture = (): MaterializedInfographic => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "GPU Guide",
  notes: "Private notes",
  originalDriveFileId: "original/private file",
  thumbnailDriveFileId: "thumbnail/private file",
  sha256: "a".repeat(64),
  detectedMimeType: "image/png",
  width: 1440,
  height: 900,
  favorite: true,
  archived: false,
  createdAt: "2026-08-19T12:34:56.000Z",
  capturedAt,
  processedAt: "2026-08-20T12:34:56.000Z",
  lastSeenAt: "2026-08-20T12:34:56.000Z",
  seenCount: 13,
  categoryIds: ["22222222-2222-4222-8222-222222222222"],
  tagIds: ["33333333-3333-4333-8333-333333333333"],
  folderState: "Library",
  reviewCount: 5,
  lastReviewedAt: "2026-08-20T12:34:56.000Z",
  reviewDueAt: "2026-08-21T12:34:56.000Z",
});

test("constructs exactly the five public fields with same-origin encoded image paths", () => {
  const item = privateFixture();
  const value = toPublicInfographic(item);

  expect(value).toEqual({
    id: item.id,
    title: item.title,
    publishedAt: capturedAt,
    thumbnailUrl: "/api/public/images/thumbnail%2Fprivate%20file",
    imageUrl: "/api/public/images/original%2Fprivate%20file",
  });
  expect(Object.keys(value)).toEqual(["id", "title", "publishedAt", "thumbnailUrl", "imageUrl"]);
  expect(PublicInfographicSchema.safeParse(value).success).toBe(true);
});

test("never serializes every private learning field family", () => {
  const item = privateFixture();
  const value = toPublicInfographic(item);
  const serialized = JSON.stringify(value);

  for (const privateField of [
    "notes", "sourceUrl", "sourcePlatform", "sourceAuthor", "originalDriveFileId", "thumbnailDriveFileId",
    "sha256", "detectedMimeType", "width", "height", "favorite", "archived", "createdAt", "processedAt",
    "lastSeenAt", "seenCount", "categoryIds", "tagIds", "folderState", "reviewCount", "lastReviewedAt", "reviewDueAt",
  ]) {
    expect(serialized).not.toContain(`"${privateField}"`);
  }
  expect(serialized).not.toContain("https://");
  expect(serialized).not.toContain(item.originalDriveFileId);
  expect(serialized).not.toContain(item.thumbnailDriveFileId);
});

test("does not mutate the owner object", () => {
  const item = privateFixture();
  const before = structuredClone(item);
  toPublicInfographic(item);
  expect(item).toEqual(before);
});
