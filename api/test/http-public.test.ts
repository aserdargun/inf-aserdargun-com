import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { InfEvent } from "@inf/contracts";
import { publicGet, publicImage, publicList, type PublicDependencies } from "../src/functions/public.js";
import type { StoragePort, StoredFile, CreateFileInput } from "../src/storage/storage-port.js";

const ids = { public: "public-root", private: "private-root", events: "events" };
const infographicId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";

class MemoryStorage implements StoragePort {
  readonly files = new Map<string, { file: StoredFile; bytes: Buffer }>();
  descendants = new Set<string>();
  isDescendantCalls = 0;
  async listChildren(folderId: string) { return [...this.files.values()].map(({ file }) => file).filter((file) => file.parentIds.includes(folderId) && !file.trashed); }
  async readFile(fileId: string) { const value = this.files.get(fileId); if (!value) throw new Error("missing"); return Buffer.from(value.bytes); }
  async createFile(input: CreateFileInput) { const id = input.fileId ?? randomUUID(); const file = { id, name: input.name, mimeType: input.mimeType, createdTime: "2026-08-21T10:00:00.000Z", parentIds: [input.parentId], appProperties: { ...(input.appProperties ?? {}) }, trashed: false }; this.files.set(id, { file, bytes: Buffer.from(input.bytes) }); return file; }
  async moveFile() { throw new Error("unused"); }
  async trashFile() { throw new Error("unused"); }
  async findByAppProperty() { return []; }
  async isDescendant(fileId: string, rootId: string) { this.isDescendantCalls += 1; return rootId === ids.public && this.descendants.has(fileId) && this.files.get(fileId)?.file.trashed === false; }
}

function createdEvent(overrides: Partial<{ eventId: string; infographicId: string; originalDriveFileId: string; thumbnailDriveFileId: string; title: string; capturedAt: string }> = {}): InfEvent {
  const id = overrides.infographicId ?? infographicId;
  const original = overrides.originalDriveFileId ?? "original-file";
  const thumbnail = overrides.thumbnailDriveFileId ?? "thumbnail-file";
  return {
    eventId: overrides.eventId ?? eventId, schemaVersion: 1, type: "infographic.created", occurredAt: "2026-08-20T10:00:00.000Z", infographicId: id,
    payload: { originalDriveFileId: original, thumbnailDriveFileId: thumbnail, sha256: "a".repeat(64), detectedMimeType: "image/png", width: 20, height: 10, title: overrides.title ?? "GPU guide", capturedAt: overrides.capturedAt ?? "2026-08-20T09:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z", folderState: "Library" },
  };
}

function fixture(): { deps: PublicDependencies; storage: MemoryStorage; events: InfEvent[] } {
  const storage = new MemoryStorage();
  const events = [createdEvent()];
  storage.descendants.add("original-file"); storage.descendants.add("thumbnail-file");
  storage.files.set("original-file", { file: { id: "original-file", name: "guide.png", mimeType: "image/png", createdTime: "2026-08-20T09:00:00.000Z", parentIds: [ids.public], appProperties: {}, trashed: false }, bytes: Buffer.from("original") });
  storage.files.set("thumbnail-file", { file: { id: "thumbnail-file", name: "guide.webp", mimeType: "image/webp", createdTime: "2026-08-20T09:00:00.000Z", parentIds: [ids.public], appProperties: {}, trashed: false }, bytes: Buffer.from("thumbnail") });
  return { storage, events, deps: { storage, publicRootId: ids.public, events: { readAll: async () => events } } };
}

async function body(response: { body?: string | Buffer }) { return JSON.parse(String(response.body)); }

describe("anonymous public HTTP API", () => {
  test("lists only the exact five public projection fields without authentication", async () => {
    const { deps, storage } = fixture();
    const response = await publicList(new Request("http://localhost/api/public/infographics"), deps);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ items: [{ id: infographicId, title: "GPU guide", publishedAt: "2026-08-20T09:00:00.000Z", thumbnailUrl: "/api/public/images/thumbnail-file", imageUrl: "/api/public/images/original-file" }], page: 1, pageSize: 12, totalItems: 1, totalPages: 1 });
    expect(response.headers?.["cache-control"]).toMatch(/^public/);
    expect(response.headers?.["content-security-policy"]).toContain("default-src 'self'");
    expect(storage.isDescendantCalls).toBe(0);
  });

  test("returns an allowlisted public item and a 404 for a malformed or missing ID", async () => {
    const { deps } = fixture();
    expect(await body(await publicGet(new Request(`http://localhost/api/public/infographics/${infographicId}`), deps))).toMatchObject({ id: infographicId });
    expect((await publicGet(new Request("http://localhost/api/public/infographics/not-a-uuid"), deps)).status).toBe(400);
    expect((await publicGet(new Request("http://localhost/api/public/infographics/00000000-0000-4000-8000-000000000099"), deps)).status).toBe(404);
  });

  test("streams a verified public image with a derived content type and immutable public cache", async () => {
    const { deps } = fixture();
    const response = await publicImage(new Request("http://localhost/api/public/images/original-file"), deps);
    expect(response).toMatchObject({ status: 200, body: Buffer.from("original") });
    expect(response.headers).toMatchObject({ "content-type": "image/png" });
    expect(response.headers?.["cache-control"]).toContain("immutable");
    expect(response.headers?.["x-content-type-options"]).toBe("nosniff");
  });

  test("never streams an untracked public descendant or a tombstoned file that remains in Drive", async () => {
    const { deps, storage, events } = fixture();
    storage.descendants.add("untracked-file");
    storage.files.set("untracked-file", { file: { id: "untracked-file", name: "unknown.bin", mimeType: "application/octet-stream", createdTime: "2026-08-20T09:00:00.000Z", parentIds: [ids.public], appProperties: {}, trashed: false }, bytes: Buffer.from("unknown") });
    expect((await publicImage(new Request("http://localhost/api/public/images/untracked-file"), deps)).status).toBe(404);
    events.push({ eventId: "00000000-0000-4000-8000-000000000003", schemaVersion: 1, type: "infographic.deleted", occurredAt: "2026-08-20T11:00:00.000Z", infographicId, payload: {} });
    expect((await publicImage(new Request("http://localhost/api/public/images/original-file"), deps)).status).toBe(404);
  });

  test.each([["original-file", "trashed"], ["thumbnail-file", "trashed"], ["original-file", "missing"], ["thumbnail-file", "missing"]] as const)("keeps the event-backed card stable but refuses detail for a %s that is %s", async (fileId, state) => {
    const { deps, storage } = fixture();
    if (state === "trashed") storage.files.get(fileId)!.file.trashed = true;
    else storage.files.delete(fileId);
    const list = await body(await publicList(new Request("http://localhost/api/public/infographics"), deps));
    expect(list).toMatchObject({ page: 1, pageSize: 12, totalItems: 1, totalPages: 1 });
    expect(list.items).toHaveLength(1);
    expect((await publicGet(new Request(`http://localhost/api/public/infographics/${infographicId}`), deps)).status).toBe(404);
  });

  test("refuses an image outside the configured public root and malformed image paths", async () => {
    const { deps } = fixture();
    expect((await publicImage(new Request("http://localhost/api/public/images/private-file"), deps)).status).toBe(404);
    expect((await publicImage(new Request("http://localhost/api/public/images/%2F"), deps)).status).toBe(400);
  });

  test("paginates the public catalog newest-first with a stable id tiebreaker", async () => {
    const storage = new MemoryStorage();
    const baseDate = new Date("2026-08-01T00:00:00.000Z").getTime();
    const events: InfEvent[] = [];
    const items: { id: string; title: string; capturedAt: string; originalDriveFileId: string; thumbnailDriveFileId: string }[] = [];
    for (let index = 0; index < 30; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const original = `original-${index}`;
      const thumbnail = `thumbnail-${index}`;
      const capturedAt = new Date(baseDate + index * 86_400_000).toISOString();
      const title = `Item ${String(index).padStart(2, "0")}`;
      events.push(createdEvent({ eventId: `00000000-0000-4000-8000-90000000${String(index + 1).padStart(4, "0")}`, infographicId: id, originalDriveFileId: original, thumbnailDriveFileId: thumbnail, title, capturedAt }));
      storage.descendants.add(original); storage.descendants.add(thumbnail);
      storage.files.set(original, { file: { id: original, name: `${original}.png`, mimeType: "image/png", createdTime: capturedAt, parentIds: [ids.public], appProperties: {}, trashed: false }, bytes: Buffer.from("o") });
      storage.files.set(thumbnail, { file: { id: thumbnail, name: `${thumbnail}.webp`, mimeType: "image/webp", createdTime: capturedAt, parentIds: [ids.public], appProperties: {}, trashed: false }, bytes: Buffer.from("t") });
      items.push({ id, title, capturedAt, originalDriveFileId: original, thumbnailDriveFileId: thumbnail });
    }
    const deps: PublicDependencies = { storage, publicRootId: ids.public, events: { readAll: async () => events } };

    const defaultPage = await body(await publicList(new Request("http://localhost/api/public/infographics"), deps));
    expect(defaultPage.page).toBe(1);
    expect(defaultPage.pageSize).toBe(12);
    expect(defaultPage.totalItems).toBe(30);
    expect(defaultPage.totalPages).toBe(3);
    expect(defaultPage.items).toHaveLength(12);
    expect(defaultPage.items[0].title).toBe("Item 29");
    expect(defaultPage.items[0].publishedAt).toBe(items[29]!.capturedAt);

    const secondPage = await body(await publicList(new Request("http://localhost/api/public/infographics?page=2"), deps));
    expect(secondPage.page).toBe(2);
    expect(secondPage.items).toHaveLength(12);
    expect(secondPage.items[0].title).toBe("Item 17");
    expect(secondPage.items[11].title).toBe("Item 06");

    const thirdPage = await body(await publicList(new Request("http://localhost/api/public/infographics?page=3"), deps));
    expect(thirdPage.page).toBe(3);
    expect(thirdPage.items).toHaveLength(6);
    expect(thirdPage.items[0].title).toBe("Item 05");

    const customSize = await body(await publicList(new Request("http://localhost/api/public/infographics?pageSize=5"), deps));
    expect(customSize.pageSize).toBe(5);
    expect(customSize.totalPages).toBe(6);
    expect(customSize.items).toHaveLength(5);
  });

  test.each([
    ["page=0", 400],
    ["page=-1", 400],
    ["page=abc", 400],
    ["pageSize=0", 400],
    ["pageSize=51", 400],
    ["pageSize=abc", 400],
    ["page=1&page=2", 400],
    ["page=1&pageSize=", 400],
  ] as const)("rejects malformed pagination query %s with 400", async (query, expected) => {
    const { deps } = fixture();
    const response = await publicList(new Request(`http://localhost/api/public/infographics?${query}`), deps);
    expect(response.status).toBe(expected);
    expect(response.headers?.["cache-control"]).toBe("no-store");
  });
});
