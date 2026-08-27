import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import { CaptureService } from "../src/services/capture-service.js";
import { ImageReplaceService } from "../src/services/image-replace-service.js";
import { EventStore } from "../src/storage/event-store.js";
import { LocalDriveAdapter } from "../src/storage/local-drive-adapter.js";
import type { CreateFileInput, StoragePort, StoredFile } from "../src/storage/storage-port.js";

const ids = { public: "public", library: "library", thumbnails: "thumbnails", duplicates: "duplicates", private: "private", events: "events" };
const folders = new Map([
  [ids.public, "public"], [ids.library, "public/Library"], [ids.duplicates, "public/Duplicates"],
  [ids.thumbnails, "public/Thumbnails"], [ids.private, "private"], [ids.events, "private/events"],
]);
const apiRoot = process.cwd().endsWith("/api") ? process.cwd() : resolve(process.cwd(), "api");
const fixtureImage = () => readFile(resolve(apiRoot, "test/fixtures/valid-infographic.png"));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

class FailingStorage implements StoragePort {
  private creates = 0;
  constructor(readonly inner: StoragePort, readonly failOnCreate?: number) {}
  listChildren(folderId: string) { return this.inner.listChildren(folderId); }
  readFile(fileId: string) { return this.inner.readFile(fileId); }
  async createFile(input: CreateFileInput): Promise<StoredFile> {
    this.creates += 1;
    if (this.failOnCreate !== undefined && this.creates === this.failOnCreate) throw new Error("planned create failure");
    return this.inner.createFile(input);
  }
  moveFile(fileId: string, fromFolderId: string, toFolderId: string) { return this.inner.moveFile(fileId, fromFolderId, toFolderId); }
  trashFile(fileId: string) { return this.inner.trashFile(fileId); }
  findByAppProperty(rootId: string, key: string, value: string) { return this.inner.findByAppProperty(rootId, key, value); }
  isDescendant(fileId: string, rootId: string) { return this.inner.isDescendant(fileId, rootId); }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "inf-replace-"));
  temporaryRoots.push(root);
  const local = new LocalDriveAdapter({ rootPath: root, folderPaths: folders });
  const events = new EventStore(local, ids.events, ids.private);
  const common = { storage: local, events, publicRootId: ids.public, libraryFolderId: ids.library, thumbnailsFolderId: ids.thumbnails, duplicatesFolderId: ids.duplicates,
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    uuid: (() => { let serial = 0; return () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`; })(),
  };
  return { root, local, storage: local, events, capture: new CaptureService(common), replace: new ImageReplaceService(common) };
}

describe("ImageReplaceService", () => {
  test("replaces Drive assets, appends imageReplaced event, and returns the updated item", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const created = await f.capture.capture({ bytes, declaredMime: "image/png", name: "original.png" });
    if (created.kind !== "created") throw new Error("expected created");
    const id = created.infographicId;
    const differentBytes = Buffer.concat([bytes, Buffer.from([0])]);
    const result = await f.replace.replace({ infographicId: id, bytes: differentBytes, declaredMime: "image/png", name: "replacement.png" });
    expect(result.infographic.originalDriveFileId).not.toBe(created.original.id);
    expect(result.infographic.thumbnailDriveFileId).not.toBe(created.thumbnail.id);
    expect(result.infographic.sha256).toBe(sha256(differentBytes));
    expect(await f.local.listChildren(ids.thumbnails)).toHaveLength(1);
    expect(await f.local.listChildren(ids.library)).toHaveLength(1);
    const events = await f.events.readAll();
    expect(events.at(-1)).toMatchObject({ type: "infographic.imageReplaced", infographicId: id, payload: expect.objectContaining({ originalDriveFileId: result.original.id, thumbnailDriveFileId: result.thumbnail.id, previousOriginalDriveFileId: created.original.id, previousThumbnailDriveFileId: created.thumbnail.id, sha256: sha256(differentBytes) }) });
  });

  test("rejects replacement when the same sha already exists in storage for a different infographic (409 DUPLICATE_IMAGE)", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "first.png" });
    if (first.kind !== "created") throw new Error("expected created");
    const differentBytes = Buffer.concat([bytes, Buffer.from([1])]);
    const second = await f.capture.capture({ bytes: differentBytes, declaredMime: "image/png", name: "second.png" });
    if (second.kind !== "created") throw new Error("expected created");
    await expect(f.replace.replace({ infographicId: second.infographicId, bytes, declaredMime: "image/png", name: "replacement.png" })).rejects.toMatchObject({ code: "DUPLICATE_IMAGE", status: 409 });
  });

  test("rejects replacement when the same sha is in the event stream for a different infographic (409 DUPLICATE_IMAGE)", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "first.png" });
    if (first.kind !== "created") throw new Error("expected created");
    const differentBytes = Buffer.concat([bytes, Buffer.from([2])]);
    const second = await f.capture.capture({ bytes: differentBytes, declaredMime: "image/png", name: "second.png" });
    if (second.kind !== "created") throw new Error("expected created");
    await expect(f.replace.replace({ infographicId: second.infographicId, bytes, declaredMime: "image/png", name: "swap.png" })).rejects.toMatchObject({ code: "DUPLICATE_IMAGE", status: 409 });
  });

  test("allows re-replacing an infographic with its own current image (idempotent sha re-use)", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "a.png" });
    if (first.kind !== "created") throw new Error("expected created");
    await expect(f.replace.replace({ infographicId: first.infographicId, bytes, declaredMime: "image/png", name: "a-again.png" })).resolves.toMatchObject({ infographic: expect.objectContaining({ id: first.infographicId }) });
  });

  test("rejects an invalid image before any Drive writes", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "a.png" });
    if (first.kind !== "created") throw new Error("expected created");
    await expect(f.replace.replace({ infographicId: first.infographicId, bytes: Buffer.from("not an image"), declaredMime: "image/png", name: "bad.png" })).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
    expect(await f.local.listChildren(ids.library)).toHaveLength(1);
    expect(await f.local.listChildren(ids.thumbnails)).toHaveLength(1);
  });

  test("trashes only the just-created derivatives if event append fails (cleanup cannot hide primary error)", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "a.png" });
    if (first.kind !== "created") throw new Error("expected created");
    const failing = new FailingStorage(f.local, 1);
    const replace = new ImageReplaceService({ storage: failing, events: f.events, publicRootId: ids.public, libraryFolderId: ids.library, thumbnailsFolderId: ids.thumbnails, now: () => new Date("2026-08-25T10:00:00.000Z"), uuid: (() => { let serial = 100; return () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`; })() });
    const differentBytes = Buffer.concat([bytes, Buffer.from([3])]);
    await expect(replace.replace({ infographicId: first.infographicId, bytes: differentBytes, declaredMime: "image/png", name: "different.png" })).rejects.toThrow(/planned create failure/);
    expect(await failing.listChildren(ids.thumbnails)).toHaveLength(1);
    expect(await failing.listChildren(ids.library)).toHaveLength(1);
  });

  test("reflects a sequence of imageReplaced events in the materialized catalog", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "a.png" });
    if (first.kind !== "created") throw new Error("expected created");
    const differentBytes = Buffer.concat([bytes, Buffer.from([7])]);
    const second = await f.replace.replace({ infographicId: first.infographicId, bytes: differentBytes, declaredMime: "image/png", name: "b.png" });
    const moreDifferent = Buffer.concat([differentBytes, Buffer.from([8])]);
    const third = await f.replace.replace({ infographicId: first.infographicId, bytes: moreDifferent, declaredMime: "image/png", name: "c.png" });
    expect(second.infographic.originalDriveFileId).not.toBe(first.original.id);
    expect(third.infographic.originalDriveFileId).not.toBe(second.infographic.originalDriveFileId);
    const events = await f.events.readAll();
    expect(events.filter((event) => (event as { type?: string }).type === "infographic.imageReplaced")).toHaveLength(2);
  });

  test("stores new file metadata with bounded safe name and exact infSha256/infId app properties", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "a.png" });
    if (first.kind !== "created") throw new Error("expected created");
    const differentBytes = Buffer.concat([bytes, Buffer.from([9])]);
    await f.replace.replace({ infographicId: first.infographicId, bytes: differentBytes, declaredMime: "image/png", name: "/etc/passwd" });
    const library = await f.local.listChildren(ids.library);
    const replacement = library.find((file) => file.id !== first.original.id);
    expect(replacement).toBeDefined();
    expect(replacement?.name).not.toContain("/");
    expect(replacement?.appProperties).toMatchObject({ infId: first.infographicId, infSha256: sha256(differentBytes) });
  });

  test("places the new original in the Library folder regardless of the previous original's parent", async () => {
    const f = await setup();
    const bytes = await fixtureImage();
    const first = await f.capture.capture({ bytes, declaredMime: "image/png", name: "a.png" });
    if (first.kind !== "created") throw new Error("expected created");
    const differentBytes = Buffer.concat([bytes, Buffer.from([11])]);
    // Re-parent the existing original into the duplicates folder (the only
    // folder besides library that exists in the post-Inbox layout) to make
    // sure the replace path always lands the new original in Library.
    await f.storage.moveFile(first.original.id, ids.library, ids.duplicates);
    const result = await f.replace.replace({ infographicId: first.infographicId, bytes: differentBytes, declaredMime: "image/png", name: "after-move.png" });
    expect(result.original.parentIds).toEqual([ids.library]);
  });
});
