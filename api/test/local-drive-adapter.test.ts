import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { EventStore } from "../src/storage/event-store.js";
import { LocalDriveAdapter } from "../src/storage/local-drive-adapter.js";
import type { CreateFileInput, StoragePort, StoredFile } from "../src/storage/storage-port.js";
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

const bundleName = (id: string) => `${id}.inf-bundle`;
function writeForeignBundle(path: string, replacement: "data" | "metadata" | "both", prefix: string): void {
  mkdirSync(path);
  if (replacement === "data" || replacement === "both") writeFileSync(join(path, "data"), `${prefix}-data`, { flag: "wx" });
  if (replacement === "metadata" || replacement === "both") writeFileSync(join(path, "metadata.json"), `${prefix}-metadata`, { flag: "wx" });
}

class ClaimStorage implements StoragePort {
  claims: StoredFile[] = []; bytes = new Map<string, Buffer>(); operations: string[] = []; created?: CreateFileInput; gate?: Promise<void>; createdClaim = false;
  async listChildren() { return []; } async readFile(id: string) { this.operations.push(`read:${id}`); return Buffer.from(this.bytes.get(id)!); }
  async createFile(input: CreateFileInput) { this.created = input; await this.gate; this.createdClaim = true; return { id: "created", name: input.name, mimeType: input.mimeType, createdTime: "2026-01-01T00:00:00.000Z", parentIds: [input.parentId], appProperties: { ...input.appProperties }, trashed: false }; }
  async moveFile() {} async trashFile(id: string) { this.operations.push(`trash:${id}`); this.claims = this.claims.filter((claim) => claim.id !== id); }
  async findByAppProperty() { return this.createdClaim ? this.claims : []; } async isDescendant() { return true; }
}
const claim = (id: string): StoredFile => ({ id, name: `${id}.json`, mimeType: "application/json", createdTime: "2026-01-01T00:00:00.000Z", parentIds: [ids.events], appProperties: { infEventId: "33333333-3333-4333-8333-333333333333" }, trashed: false });

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
    const bundle = join(root, "public", "Inbox", bundleName(created.id));
    expect((await readdir(bundle)).sort()).toEqual(["data", "metadata.json"]);
    expect((await lstat(bundle)).isDirectory()).toBe(true);
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
    expect(JSON.parse(await readFile(join(root, "private", "events", bundleName(event.eventId), "data"), "utf8"))).toEqual(event);
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

  test("rejects symlinked configured folders and forged bundles without following outside paths", async () => {
    const { root, storage: initial } = await fixture();
    await initial.listChildren(ids.publicRoot);
    const outside = await mkdtemp(join(tmpdir(), "inf-outside-"));
    temporaryRoots.push(outside);
    await symlink(outside, join(root, "public", "Inbox"));
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    await expect(storage.listChildren(ids.inbox)).rejects.toThrow(/symlink/i);
    const forged = join(root, "public", bundleName("forged")); await mkdir(forged); await symlink(outside, join(forged, "data")); await writeFile(join(forged, "metadata.json"), "{}");
    const safe = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    await expect(safe.listChildren(ids.publicRoot)).rejects.toThrow(/malformed|path|symlink|unsafe/i);
  });

  test.each([
    ["root symlink", "root"], ["ancestor symlink", "public"], ["terminal folder symlink", "Inbox"], [".trash symlink", ".trash"],
  ])("refuses %s before writing outside sentinel", async (_label, segment) => {
    const root = await mkdtemp(join(tmpdir(), "inf-symlink-matrix-")); temporaryRoots.push(root);
    const outside = await mkdtemp(join(tmpdir(), "inf-outside-matrix-")); temporaryRoots.push(outside); await writeFile(join(outside, "sentinel"), "safe");
    if (segment === "root") {
      await rm(root, { recursive: true });
      await symlink(outside, root);
      const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
      await expect(storage.listChildren(ids.inbox)).rejects.toThrow(/symlink|unsafe/i);
    } else {
      const setup = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
      const sourceBytes = Buffer.from("x");
      const source = await setup.createFile({ name: "source.png", mimeType: "image/png", parentId: ids.inbox, bytes: sourceBytes });
      const target = segment === ".trash" ? join(root, ".trash") : segment === "public" ? join(root, "public") : join(root, "public", "Inbox");
      if (segment !== ".trash") {
        await rm(target, { recursive: true });
      }
      await symlink(outside, target);
      if (segment === ".trash") {
        await expect(setup.trashFile(source.id)).rejects.toThrow(/symlink|unsafe/i);
        await rm(target);
        expect(await setup.readFile(source.id)).toEqual(sourceBytes);
        expect(await setup.listChildren(ids.inbox)).toEqual([expect.objectContaining({ id: source.id })]);
      } else {
        await expect(setup.listChildren(ids.inbox)).rejects.toThrow(/symlink|unsafe/i);
      }
      expect(await readdir(outside)).toEqual(["sentinel"]);
      expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("safe");
    }
  });

  test.each(["beforeDataPublish", "afterDataPublish", "beforeMetadataPublish", "afterMetadataPublish", "afterSourceMetadataRemove", "afterSourceDataRemove"] as const)("retries every partial move publication fault without invisible debris at %s", async (step) => {
    const root = await mkdtemp(join(tmpdir(), "inf-atomic-")); temporaryRoots.push(root);
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots, fault: (at) => { if (at === step) throw new Error(step); } });
    const created = await storage.createFile({ name: "atomic.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("atomic") });
    await expect(storage.moveFile(created.id, ids.inbox, ids.library)).rejects.toThrow(step);
    expect(await storage.readFile(created.id)).toEqual(Buffer.from("atomic"));
    expect(await storage.listChildren(ids.inbox)).toEqual([expect.objectContaining({ id: created.id })]);
    expect(await readdir(join(root, "public", "Library"))).toEqual([]);
    const reloaded = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    await reloaded.moveFile(created.id, ids.inbox, ids.library);
    expect(await reloaded.listChildren(ids.inbox)).toEqual([]);
    expect(await reloaded.listChildren(ids.library)).toEqual([expect.objectContaining({ id: created.id })]);
    expect(await readdir(join(root, "public", "Library"))).toEqual([bundleName(created.id)]);
    expect((await readdir(join(root, "public", "Library", bundleName(created.id)))).sort()).toEqual(["data", "metadata.json"]);
    expect(await reloaded.readFile(created.id)).toEqual(Buffer.from("atomic"));
  });

  test.each(["beforeDataPublish", "afterDataPublish", "beforeMetadataPublish", "afterMetadataPublish", "afterSourceMetadataRemove", "afterSourceDataRemove"] as const)("retries every partial trash publication fault at %s", async (step) => {
    const root = await mkdtemp(join(tmpdir(), "inf-atomic-trash-")); temporaryRoots.push(root);
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots, fault: (at) => { if (at === step) throw new Error(step); } });
    const created = await storage.createFile({ name: "atomic.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("atomic") });
    await expect(storage.trashFile(created.id)).rejects.toThrow(step);
    expect(await storage.readFile(created.id)).toEqual(Buffer.from("atomic"));
    expect(await storage.listChildren(ids.inbox)).toEqual([expect.objectContaining({ id: created.id })]);
    expect(await readdir(join(root, ".trash"))).toEqual([]);
    const reloaded = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    await reloaded.trashFile(created.id);
    expect(await readdir(join(root, ".trash"))).toEqual([bundleName(created.id)]);
    expect((await readdir(join(root, ".trash", bundleName(created.id)))).sort()).toEqual(["data", "metadata.json"]);
    await expect(reloaded.readFile(created.id)).rejects.toThrow(/trashed/i);
  });

  test("never replaces a foreign non-empty destination bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "inf-foreign-publication-")); temporaryRoots.push(root);
    let destination = "";
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots, fault: (at) => {
      if (at === "afterDataPublish") writeForeignBundle(destination, "both", "foreign-destination");
    } });
    const created = await storage.createFile({ name: "atomic.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("source") });
    destination = join(root, "public", "Library", bundleName(created.id));
    await expect(storage.moveFile(created.id, ids.inbox, ids.library)).rejects.toThrow(/destination|overwrite|non-empty/i);
    expect(await readFile(join(destination, "data"), "utf8")).toBe("foreign-destination-data");
    expect(await readFile(join(destination, "metadata.json"), "utf8")).toBe("foreign-destination-metadata");
    const restoredSource = join(root, "public", "Inbox", bundleName(created.id));
    expect(await readFile(join(restoredSource, "data"), "utf8")).toBe("source");
    expect(JSON.parse(await readFile(join(restoredSource, "metadata.json"), "utf8"))).toMatchObject({ id: created.id, name: "atomic.png" });
  });

  test.each(["data", "metadata", "both"] as const)("single source claim quarantines the whole original and preserves a foreign source %s bundle", async (replacement) => {
    const root = await mkdtemp(join(tmpdir(), "inf-source-replacement-")); temporaryRoots.push(root);
    let source = "";
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots, fault: (at) => {
      if (at !== "beforeDataPublish") return;
      writeForeignBundle(source, replacement, "foreign-source");
    } });
    const created = await storage.createFile({ name: "source.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("original-source") });
    source = join(root, "public", "Inbox", bundleName(created.id));
    await expect(storage.moveFile(created.id, ids.inbox, ids.library)).rejects.toThrow(/quarantine|foreign source/i);
    if (replacement === "data" || replacement === "both") expect(await readFile(join(source, "data"), "utf8")).toBe("foreign-source-data");
    if (replacement === "metadata" || replacement === "both") expect(await readFile(join(source, "metadata.json"), "utf8")).toBe("foreign-source-metadata");
    const operations = await readdir(join(root, ".operations"));
    expect(operations).toHaveLength(1);
    expect(await readFile(join(root, ".operations", operations[0], "data"), "utf8")).toBe("original-source");
    expect(JSON.parse(await readFile(join(root, ".operations", operations[0], "metadata.json"), "utf8"))).toMatchObject({ id: created.id });
  });

  test.each(["data", "metadata", "both"] as const)("rollback-boundary restore preserves a foreign source %s bundle and the whole original", async (replacement) => {
    const root = await mkdtemp(join(tmpdir(), "inf-rollback-replacement-")); temporaryRoots.push(root);
    let source = "";
    const storage = new LocalDriveAdapter({ rootPath: root, folderPaths: roots, fault: (at) => {
      if (at === "beforeMetadataPublish") throw new Error("force rollback");
      if ((at as string) === "beforeSourceRestore") writeForeignBundle(source, replacement, "rollback-foreign");
    } });
    const created = await storage.createFile({ name: "source.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("original-source") });
    source = join(root, "public", "Inbox", bundleName(created.id));
    await expect(storage.moveFile(created.id, ids.inbox, ids.library)).rejects.toThrow(/quarantine|rollback|foreign source/i);
    if (replacement === "data" || replacement === "both") expect(await readFile(join(source, "data"), "utf8")).toBe("rollback-foreign-data");
    if (replacement === "metadata" || replacement === "both") expect(await readFile(join(source, "metadata.json"), "utf8")).toBe("rollback-foreign-metadata");
    const [operation] = await readdir(join(root, ".operations"));
    expect(await readFile(join(root, ".operations", operation, "data"), "utf8")).toBe("original-source");
    expect(JSON.parse(await readFile(join(root, ".operations", operation, "metadata.json"), "utf8"))).toMatchObject({ id: created.id });
  });

  test("rejects legacy split-pair local data with an explicit reset instruction", async () => {
    const { storage, root } = await fixture(); await storage.listChildren(ids.inbox);
    await writeFile(join(root, "public", "Inbox", "legacy.blob"), "legacy");
    await writeFile(join(root, "public", "Inbox", "legacy.blob.inf-meta.json"), "{}");
    await expect(storage.listChildren(ids.inbox)).rejects.toThrow(/legacy|reset/i);
  });

  test.each(["missing-data", "missing-metadata", "wrong-name"] as const)("rejects an atomic bundle with %s integrity", async (mutation) => {
    const { storage, root } = await fixture();
    const created = await storage.createFile({ name: "integrity.png", mimeType: "image/png", parentId: ids.inbox, bytes: Buffer.from("integrity") });
    const bundle = join(root, "public", "Inbox", bundleName(created.id));
    if (mutation === "missing-data") await rm(join(bundle, "data"));
    else if (mutation === "missing-metadata") await rm(join(bundle, "metadata.json"));
    else await rename(bundle, join(root, "public", "Inbox", bundleName("wrong-id")));
    const reloaded = new LocalDriveAdapter({ rootPath: root, folderPaths: roots });
    await expect(reloaded.listChildren(ids.inbox)).rejects.toThrow(/bundle|metadata|name/i);
  });

  test("preserves every claim when the deterministic lowest event claim conflicts", async () => {
    const storage = new ClaimStorage(); let release!: () => void; storage.gate = new Promise((resolve) => { release = resolve; }); const event = { eventId: "33333333-3333-4333-8333-333333333333", schemaVersion: 1 as const, type: "sync.fileRejected" as const, occurredAt: "2026-08-21T10:00:00.000Z", payload: { driveFileId: "x", fileName: "x", reason: "x" } };
    const store = new EventStore(storage, ids.events, ids.privateRoot);
    const append = store.append(event); await new Promise((resolve) => setImmediate(resolve)); storage.claims = [claim("a"), claim("created")]; storage.bytes.set("a", Buffer.from("foreign")); storage.bytes.set("created", storage.created!.bytes); release();
    await expect(append).rejects.toThrow(/integrity/i); expect(storage.operations.filter((operation) => operation.startsWith("trash"))).toEqual([]); expect(storage.operations.filter((operation) => operation.startsWith("read"))).toEqual(["read:a", "read:created"]);
  });

  test("reconciles identical event claims only after reading all claims", async () => {
    const storage = new ClaimStorage(); let release!: () => void; storage.gate = new Promise((resolve) => { release = resolve; }); const event = { eventId: "33333333-3333-4333-8222-333333333333", schemaVersion: 1 as const, type: "sync.fileRejected" as const, occurredAt: "2026-08-21T10:00:00.000Z", payload: { driveFileId: "x", fileName: "x", reason: "x" } };
    const store = new EventStore(storage, ids.events, ids.privateRoot); const append = store.append(event); await new Promise((resolve) => setImmediate(resolve)); storage.claims = [claim("a"), claim("created"), claim("z")].map((item) => ({ ...item, appProperties: { infEventId: event.eventId } })); for (const item of storage.claims) storage.bytes.set(item.id, storage.created!.bytes); release();
    await expect(append).resolves.toBeUndefined(); expect(storage.operations.slice(0, 3)).toEqual(["read:a", "read:created", "read:z"]); expect(storage.operations.slice(3)).toEqual(["trash:created", "trash:z"]);
  });
});
