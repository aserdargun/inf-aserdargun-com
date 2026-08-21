import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { EventStore } from "../src/storage/event-store.js";
import { LocalDriveAdapter } from "../src/storage/local-drive-adapter.js";
import { assertStorageContract } from "./storage-contract.js";

const ids = {
  publicRoot: "public-root",
  inbox: "inbox",
  library: "library",
  duplicates: "duplicates",
  thumbnails: "thumbnails",
  privateRoot: "private-root",
  events: "events",
};

const roots = new Map([
  [ids.publicRoot, "public"],
  [ids.inbox, "public/Inbox"],
  [ids.library, "public/Library"],
  [ids.duplicates, "public/Duplicates"],
  [ids.thumbnails, "public/Thumbnails"],
  [ids.privateRoot, "private"],
  [ids.events, "private/events"],
]);

const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "inf-storage-"));
  temporaryRoots.push(root);
  return { storage: new LocalDriveAdapter({ rootPath: root, folderPaths: roots }), root };
}

describe("LocalDriveAdapter", () => {
  test("obeys the shared storage contract", async () => {
    const { storage } = await fixture();
    await assertStorageContract({ storage, rootId: ids.publicRoot, inboxId: ids.inbox, libraryId: ids.library });
  });

  test("persists metadata across adapter reload and rejects unknown or escaping roots", async () => {
    const { storage, root } = await fixture();
    const created = await storage.createFile({ name: "persist.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("x") });
    const reloaded = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    expect(await reloaded.readFile(created.id)).toEqual(Buffer.from("x"));
    await expect(reloaded.listChildren("unknown")).rejects.toThrow(/configured/i);
    await expect(reloaded.createFile({ name: "../escape", mimeType: "text/plain", parentId: ids.inbox, bytes: Buffer.from("x") })).rejects.toThrow(/name/i);
  });

  test("keeps private immutable events out of the public root and rejects duplicate event IDs", async () => {
    const { storage, root } = await fixture();
    const events = new EventStore(storage, ids.events, ids.privateRoot);
    const event = {
      eventId: "11111111-1111-4111-8111-111111111111",
      schemaVersion: 1 as const,
      type: "sync.fileRejected" as const,
      occurredAt: "2026-08-21T10:00:00.000Z",
      payload: { driveFileId: "manual", fileName: "bad.png", reason: "bad image" },
    };
    await events.append(event);
    await expect(events.append(event)).rejects.toThrow(/duplicate/i);
    expect(await events.readAll()).toEqual([event]);
    expect(JSON.parse(await readFile(join(root, "private", "events", `${event.eventId}.json`), "utf8"))).toEqual(event);
    expect(await storage.listChildren(ids.publicRoot)).toEqual([]);
  });

  test("rejects a public or forged event folder before writes and serializes duplicate append claims", async () => {
    const { storage } = await fixture();
    const event = { eventId: "22222222-2222-4222-8222-222222222222", schemaVersion: 1 as const, type: "sync.fileRejected" as const, occurredAt: "2026-08-21T10:00:00.000Z", payload: { driveFileId: "manual", fileName: "bad.png", reason: "bad image" } };
    const publicEvents = new EventStore(storage, ids.inbox, ids.privateRoot);
    await expect(publicEvents.append(event)).rejects.toThrow(/private/i);
    const events = new EventStore(storage, ids.events, ids.privateRoot);
    const settled = await Promise.allSettled([events.append(event), events.append(event)]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await events.readAll()).toEqual([event]);
  });

  test("rejects symlinked configured folders and forged sidecars without following outside paths", async () => {
    const { root, storage: initial } = await fixture();
    await initial.listChildren(ids.publicRoot);
    const outside = await mkdtemp(join(tmpdir(), "inf-outside-"));
    temporaryRoots.push(outside);
    await symlink(outside, join(root, "public", "Inbox"));
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    await expect(storage.listChildren(ids.inbox)).rejects.toThrow(/symlink/i);
    await writeFile(join(root, "public", "forged.blob.inf-meta.json"), JSON.stringify({ id: "forged", name: "forged", mimeType: "text/plain", createdTime: "not-a-date", parentIds: [ids.publicRoot], appProperties: {}, trashed: false, dataPath: outside }));
    const safe = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    await expect(safe.listChildren(ids.publicRoot)).rejects.toThrow(/malformed|path/i);
  });

  test.each(["afterDataPublish", "afterMetadataPublish"] as const)("rolls back move and trash publication faults at %s", async (step) => {
    const root = await mkdtemp(join(tmpdir(), "inf-atomic-")); temporaryRoots.push(root);
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots, fault: (at) => { if (at === step) throw new Error(step); } });
    const created = await storage.createFile({ name: "atomic.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("atomic") });
    await expect(storage.moveFile(created.id, ids.inbox, ids.library)).rejects.toThrow(step);
    expect(await storage.readFile(created.id)).toEqual(Buffer.from("atomic"));
    expect(await storage.listChildren(ids.inbox)).toEqual([expect.objectContaining({ id: created.id })]);
    expect(await storage.listChildren(ids.library)).toEqual([]);
    await expect(storage.trashFile(created.id)).rejects.toThrow(step);
    expect(await storage.readFile(created.id)).toEqual(Buffer.from("atomic"));
    expect(await readdir(join(root, ".trash"))).toEqual([]);
  });
});
