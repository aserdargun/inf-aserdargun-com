import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CaptureService } from "../src/services/capture-service.js";
import { SyncService } from "../src/services/sync-service.js";
import { EventStore } from "../src/storage/event-store.js";
import { LocalDriveAdapter } from "../src/storage/local-drive-adapter.js";
import type { CreateFileInput, StoragePort, StoredFile } from "../src/storage/storage-port.js";

const ids = { public: "public", inbox: "inbox", duplicates: "duplicates", thumbnails: "thumbnails", private: "private", events: "events" };
const folders = new Map([
  [ids.public, "public"], [ids.inbox, "public/Inbox"], [ids.duplicates, "public/Duplicates"],
  [ids.thumbnails, "public/Thumbnails"], [ids.private, "private"], [ids.events, "private/events"],
]);
const apiRoot = process.cwd().endsWith("/api") ? process.cwd() : resolve(process.cwd(), "api");
const fixtureImage = () => readFile(resolve(apiRoot, "test/fixtures/valid-infographic.png"));
const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

class FailingStorage implements StoragePort {
  private creates = 0;
  constructor(readonly inner: StoragePort, private readonly failOnCreate: number) {}
  listChildren(folderId: string) { return this.inner.listChildren(folderId); }
  readFile(fileId: string) { return this.inner.readFile(fileId); }
  async createFile(input: CreateFileInput): Promise<StoredFile> {
    this.creates += 1;
    if (this.creates === this.failOnCreate) throw new Error("planned create failure");
    return this.inner.createFile(input);
  }
  moveFile(fileId: string, fromFolderId: string, toFolderId: string) { return this.inner.moveFile(fileId, fromFolderId, toFolderId); }
  trashFile(fileId: string) { return this.inner.trashFile(fileId); }
  findByAppProperty(rootId: string, key: string, value: string) { return this.inner.findByAppProperty(rootId, key, value); }
  isDescendant(fileId: string, rootId: string) { return this.inner.isDescendant(fileId, rootId); }
}

async function fixture(failOnCreate?: number) {
  const root = await mkdtemp(join(tmpdir(), "inf-sync-"));
  temporaryRoots.push(root);
  const local = new LocalDriveAdapter({ rootPath: root, folderPaths: folders });
  const storage = failOnCreate === undefined ? local : new FailingStorage(local, failOnCreate);
  const events = new EventStore(storage, ids.events, ids.private);
  const common = { storage, events, publicRootId: ids.public, inboxFolderId: ids.inbox, thumbnailsFolderId: ids.thumbnails, duplicatesFolderId: ids.duplicates,
    now: () => new Date("2026-08-21T10:00:00.000Z"),
    uuid: (() => { let serial = 0; return () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`; })(),
  };
  return { root, storage, local, events, capture: new CaptureService(common), sync: new SyncService(common) };
}

describe("capture and manual Inbox sync", () => {
  test("captures unchanged original, WebP thumbnail, immutable event, then reports a duplicate", async () => {
    const f = await fixture();
    const bytes = await fixtureImage();
    const created = await f.capture.capture({ bytes, declaredMime: "image/png", name: "  GPU\nchart.png " });
    expect(created).toMatchObject({ kind: "created", title: "GPU chart", original: { parentIds: [ids.inbox] }, thumbnail: { parentIds: [ids.thumbnails], mimeType: "image/webp" } });
    expect(await f.storage.readFile((created as Extract<typeof created, { kind: "created" }>).original.id)).toEqual(bytes);
    expect(await f.events.readAll()).toContainEqual(expect.objectContaining({ type: "infographic.created" }));
    await expect(f.capture.capture({ bytes, declaredMime: "image/png", name: "again.png" })).resolves.toMatchObject({ kind: "duplicate" });
  });

  test("validates complete optional capture metadata before writes and persists explicit nulls", async () => {
    const f = await fixture();
    const bytes = await fixtureImage();
    await expect(f.capture.capture({ bytes, declaredMime: "image/png", name: "file.png", title: "A separate title", notes: null, sourceUrl: null, sourcePlatform: undefined, sourceAuthor: null }))
      .resolves.toMatchObject({ kind: "created", title: "A separate title" });
    expect(await f.events.readAll()).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ title: "A separate title", notes: null, sourceUrl: null, sourceAuthor: null }) }));

    const invalid = await fixture();
    await expect(invalid.capture.capture({ bytes, declaredMime: "image/png", name: "file.png", sourceUrl: "not-a-url" }))
      .rejects.toThrow();
    expect(await invalid.storage.listChildren(ids.inbox)).toEqual([]);
    expect(await invalid.storage.listChildren(ids.thumbnails)).toEqual([]);
  });

  test("discovers a manual Inbox image and creates a thumbnail plus event", async () => {
    const f = await fixture();
    const manual = await f.storage.createFile({ name: "diagram.png", mimeType: "image/png", parentId: ids.inbox, bytes: await fixtureImage() });
    await expect(f.sync.syncInbox()).resolves.toEqual({ imported: 1, duplicates: 0, rejected: 0 });
    expect(await f.events.readAll()).toContainEqual(expect.objectContaining({ type: "infographic.created", payload: expect.objectContaining({ originalDriveFileId: manual.id }) }));
    expect(await f.events.readAll()).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ capturedAt: manual.createdTime, createdAt: "2026-08-21T10:00:00.000Z" }) }));
    expect(await f.storage.listChildren(ids.thumbnails)).toHaveLength(1);
  });

  test("serializes concurrent same-process captures so only one original and event win", async () => {
    const f = await fixture();
    const bytes = await fixtureImage();
    const results = await Promise.all([f.capture.capture({ bytes, declaredMime: "image/png", name: "one.png" }), f.capture.capture({ bytes, declaredMime: "image/png", name: "two.png" })]);
    expect(results.map((result) => result.kind).sort()).toEqual(["created", "duplicate"]);
    expect(await f.storage.listChildren(ids.inbox)).toHaveLength(1);
    expect(await f.events.readAll()).toHaveLength(1);
  });

  test("moves hash duplicates to Duplicates and records invalid manual files only once", async () => {
    const f = await fixture();
    const original = await f.storage.createFile({ name: "original.png", mimeType: "image/png", parentId: ids.inbox, bytes: await fixtureImage() });
    await f.sync.syncInbox();
    const duplicate = await f.storage.createFile({ name: "copy.png", mimeType: "image/png", parentId: ids.inbox, bytes: await f.storage.readFile(original.id) });
    const invalid = await f.storage.createFile({ name: "not-image.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("not an image") });
    await expect(f.sync.syncInbox()).resolves.toEqual({ imported: 0, duplicates: 1, rejected: 1 });
    expect(await f.storage.listChildren(ids.duplicates)).toEqual([expect.objectContaining({ id: duplicate.id })]);
    expect(await f.storage.listChildren(ids.inbox)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.id }), expect.objectContaining({ id: invalid.id }),
    ]));
    await expect(f.sync.syncInbox()).resolves.toEqual({ imported: 0, duplicates: 0, rejected: 0 });
  });

  test("trashes only a newly-created derivative if event append fails", async () => {
    const f = await fixture(3);
    const manual = await f.storage.createFile({ name: "diagram.png", mimeType: "image/png", parentId: ids.inbox, bytes: await fixtureImage() });
    await expect(f.sync.syncInbox()).rejects.toThrow("planned create failure");
    expect(await f.local.readFile(manual.id)).toEqual(await fixtureImage());
    expect(await f.local.listChildren(ids.thumbnails)).toEqual([]);
  });

  test("uses a safe bounded sync limit and stable createdTime/file ID ordering", async () => {
    const f = await fixture();
    await f.storage.createFile({ name: "a.png", mimeType: "image/png", parentId: ids.inbox, bytes: await fixtureImage() });
    await f.storage.createFile({ name: "b.png", mimeType: "image/png", parentId: ids.inbox, bytes: await fixtureImage() });
    await expect(f.sync.syncInbox({ limit: 1 })).resolves.toEqual({ imported: 1, duplicates: 0, rejected: 0 });
    await expect(f.sync.syncInbox({ limit: 51 })).rejects.toThrow(/limit/i);
    await expect(f.sync.syncInbox({ limit: 0 })).rejects.toThrow(/limit/i);
  });
});
