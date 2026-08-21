import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    const events = new EventStore(storage, ids.events);
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
});
