import { describe, expect, test } from "vitest";
import { CachedStorage } from "../src/cache/cached-storage.js";
import type { CreateFileInput, StoragePort, StoredFile } from "../src/storage/storage-port.js";

class FakeStorage implements StoragePort {
  descentCalls: Array<[string, string]> = [];
  readCalls: string[] = [];
  createCalls: CreateFileInput[] = [];
  moveCalls: Array<[string, string, string]> = [];
  trashCalls: string[] = [];
  findCalls: Array<[string, string, string]> = [];

  isDescendantResults = new Map<string, boolean>();
  readResults = new Map<string, Buffer>();
  nextCreateId = 0;

  async isDescendant(fileId: string, rootId: string): Promise<boolean> {
    this.descentCalls.push([fileId, rootId]);
    return this.isDescendantResults.get(`${rootId}:${fileId}`) ?? false;
  }

  async readFile(fileId: string): Promise<Buffer> {
    this.readCalls.push(fileId);
    const value = this.readResults.get(fileId);
    if (!value) throw new Error(`not found: ${fileId}`);
    return value;
  }

  async createFile(input: CreateFileInput): Promise<StoredFile> {
    this.createCalls.push(input);
    this.nextCreateId += 1;
    return {
      id: `created-${this.nextCreateId}`,
      name: input.name, mimeType: input.mimeType, createdTime: new Date().toISOString(),
      parentIds: [input.parentId], appProperties: { ...(input.appProperties ?? {}) }, trashed: false,
    };
  }

  async moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    this.moveCalls.push([fileId, fromFolderId, toFolderId]);
  }
  async trashFile(fileId: string): Promise<void> { this.trashCalls.push(fileId); }
  async listChildren(): Promise<StoredFile[]> { return []; }
  async findByAppProperty(rootId: string, key: string, value: string): Promise<StoredFile[]> {
    this.findCalls.push([rootId, key, value]);
    return [];
  }
}

describe("CachedStorage", () => {
  test("twenty simultaneous image and ancestry requests perform one underlying read each", async () => {
    const inner = new FakeStorage();
    inner.readResults.set("image", Buffer.from("image"));
    inner.isDescendantResults.set("public:image", true);
    const storage = new CachedStorage(inner, { descentTtlMs: 1000, fileTtlMs: 1000, descentMaxEntries: 16, fileMaxEntries: 16 });
    const results = await Promise.all(Array.from({ length: 20 }, () => Promise.all([
      storage.readFile("image"), storage.isDescendant("image", "public"),
    ])));
    expect(results.every(([bytes, allowed]) => bytes.equals(Buffer.from("image")) && allowed)).toBe(true);
    expect(inner.readCalls).toEqual(["image"]);
    expect(inner.descentCalls).toEqual([["image", "public"]]);
  });

  test("a failed shared request is removed so a retry can recover", async () => {
    const inner = new FakeStorage();
    const storage = new CachedStorage(inner, { descentTtlMs: 1000, fileTtlMs: 1000, descentMaxEntries: 16, fileMaxEntries: 16 });
    const results = await Promise.allSettled([storage.readFile("image"), storage.readFile("image")]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    inner.readResults.set("image", Buffer.from("recovered"));
    expect(await storage.readFile("image")).toEqual(Buffer.from("recovered"));
    expect(inner.readCalls).toHaveLength(2);
  });

  test("post-mutation reads do not join stale reads or let their cleanup remove a newer request", async () => {
    const inner = new FakeStorage();
    const releases: Array<(bytes: Buffer) => void> = [];
    inner.readFile = async () => new Promise<Buffer>((resolve) => releases.push(resolve));
    const storage = new CachedStorage(inner, { descentTtlMs: 1000, fileTtlMs: 1000, descentMaxEntries: 16, fileMaxEntries: 16 });
    const before = storage.readFile("image");
    await storage.trashFile("image");
    const after = storage.readFile("image");
    releases[0](Buffer.from("old")); await before;
    const joined = storage.readFile("image");
    expect(releases).toHaveLength(2);
    releases[1](Buffer.from("new"));
    expect(await after).toEqual(Buffer.from("new"));
    expect(await joined).toEqual(Buffer.from("new"));
    expect(await storage.readFile("image")).toEqual(Buffer.from("new"));
  });

  test("moving a parent stops new ancestry requests joining an older child check", async () => {
    const inner = new FakeStorage();
    let release!: (value: boolean) => void;
    inner.isDescendant = () => new Promise((resolve) => { release = resolve; });
    const storage = new CachedStorage(inner, { descentTtlMs: 1000, fileTtlMs: 1000, descentMaxEntries: 16, fileMaxEntries: 16 });
    const before = storage.isDescendant("child", "public");
    await storage.moveFile("parent", "public", "private");
    inner.isDescendant = async () => false;
    expect(await storage.isDescendant("child", "public")).toBe(false);
    release(true); await before;
    expect(await storage.isDescendant("child", "public")).toBe(false);
  });
  test("caches isDescendant results and tracks hit ratio", async () => {
    const inner = new FakeStorage();
    inner.isDescendantResults.set("root:file-1", true);
    const storage = new CachedStorage(inner, { descentTtlMs: 1_000, fileTtlMs: 1_000, descentMaxEntries: 16, fileMaxEntries: 16 });
    expect(await storage.isDescendant("file-1", "root")).toBe(true);
    expect(await storage.isDescendant("file-1", "root")).toBe(true);
    expect(inner.descentCalls).toEqual([["file-1", "root"]]);
    const stats = storage.describe();
    expect(stats.descentHits).toBe(1);
    expect(stats.descentMisses).toBe(1);
  });

  test("caches both true and false isDescendant answers", async () => {
    const inner = new FakeStorage();
    inner.isDescendantResults.set("root:file-1", false);
    const storage = new CachedStorage(inner, { descentTtlMs: 1_000, fileTtlMs: 1_000, descentMaxEntries: 16, fileMaxEntries: 16 });
    expect(await storage.isDescendant("file-1", "root")).toBe(false);
    expect(await storage.isDescendant("file-1", "root")).toBe(false);
    expect(inner.descentCalls.length).toBe(1);
  });

  test("caches readFile bytes", async () => {
    const inner = new FakeStorage();
    inner.readResults.set("file-1", Buffer.from("bytes"));
    const storage = new CachedStorage(inner, { descentTtlMs: 1_000, fileTtlMs: 1_000, descentMaxEntries: 16, fileMaxEntries: 16 });
    const first = await storage.readFile("file-1");
    const second = await storage.readFile("file-1");
    expect(first).toEqual(Buffer.from("bytes"));
    expect(second).toBe(first);
    expect(inner.readCalls).toEqual(["file-1"]);
  });

  test("invalidation cascades from mutations", async () => {
    const inner = new FakeStorage();
    inner.isDescendantResults.set("root:file-1", true);
    inner.readResults.set("file-1", Buffer.from("bytes"));
    const storage = new CachedStorage(inner, { descentTtlMs: 1_000, fileTtlMs: 1_000, descentMaxEntries: 16, fileMaxEntries: 16 });
    await storage.isDescendant("file-1", "root");
    await storage.readFile("file-1");
    expect(inner.descentCalls.length).toBe(1);
    expect(inner.readCalls.length).toBe(1);

    await storage.trashFile("file-1");
    inner.isDescendantResults.set("root:file-1", false);
    inner.readResults.delete("file-1");
    await expect(storage.readFile("file-1")).rejects.toThrow();
    await storage.isDescendant("file-1", "root");
    expect(inner.descentCalls.length).toBe(2);
    expect(inner.readCalls.length).toBe(2);
  });

  test("createFile invalidates cache for the new id", async () => {
    const inner = new FakeStorage();
    const storage = new CachedStorage(inner, { descentTtlMs: 1_000, fileTtlMs: 1_000, descentMaxEntries: 16, fileMaxEntries: 16 });
    const created = await storage.createFile({ name: "a", mimeType: "image/png", parentId: "p", bytes: Buffer.from("") });
    expect(inner.createCalls.length).toBe(1);
    expect(created.id).toBe("created-1");
  });

  test("rejects non-positive TTLs", () => {
    const inner = new FakeStorage();
    expect(() => new CachedStorage(inner, { descentTtlMs: 0, fileTtlMs: 1, descentMaxEntries: 1, fileMaxEntries: 1 })).toThrow();
    expect(() => new CachedStorage(inner, { descentTtlMs: 1, fileTtlMs: 0, descentMaxEntries: 1, fileMaxEntries: 1 })).toThrow();
  });
});


test("a late ancestry result cannot repopulate the cache after a move", async () => {
  const inner = new FakeStorage();
  let release!: (value: boolean) => void;
  inner.isDescendant = () => new Promise((resolve) => { release = resolve; });
  const storage = new CachedStorage(inner, { descentTtlMs: 1_000, fileTtlMs: 1_000, descentMaxEntries: 16, fileMaxEntries: 16 });
  const old = storage.isDescendant("file", "public");
  await storage.moveFile("file", "public", "private");
  release(true); await old;
  inner.isDescendant = async () => false;
  expect(await storage.isDescendant("file", "public")).toBe(false);
});

test("moving a parent invalidates cached ancestry for its children", async () => {
  const inner = new FakeStorage();
  inner.isDescendantResults.set("public:child", true);
  const storage = new CachedStorage(inner, { descentTtlMs: 1_000, fileTtlMs: 1_000, descentMaxEntries: 16, fileMaxEntries: 16 });
  expect(await storage.isDescendant("child", "public")).toBe(true);
  await storage.moveFile("parent", "public", "private");
  inner.isDescendantResults.set("public:child", false);
  expect(await storage.isDescendant("child", "public")).toBe(false);
});
