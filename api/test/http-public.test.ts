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
  async listChildren(folderId: string) { return [...this.files.values()].map(({ file }) => file).filter((file) => file.parentIds.includes(folderId) && !file.trashed); }
  async readFile(fileId: string) { const value = this.files.get(fileId); if (!value) throw new Error("missing"); return Buffer.from(value.bytes); }
  async createFile(input: CreateFileInput) { const id = input.fileId ?? randomUUID(); const file = { id, name: input.name, mimeType: input.mimeType, createdTime: "2026-08-21T10:00:00.000Z", parentIds: [input.parentId], appProperties: { ...(input.appProperties ?? {}) }, trashed: false }; this.files.set(id, { file, bytes: Buffer.from(input.bytes) }); return file; }
  async moveFile() { throw new Error("unused"); }
  async trashFile() { throw new Error("unused"); }
  async findByAppProperty() { return []; }
  async isDescendant(fileId: string, rootId: string) { return rootId === ids.public && this.descendants.has(fileId) && this.files.get(fileId)?.file.trashed === false; }
}

function createdEvent(): InfEvent {
  return {
    eventId, schemaVersion: 1, type: "infographic.created", occurredAt: "2026-08-20T10:00:00.000Z", infographicId,
    payload: { originalDriveFileId: "original-file", thumbnailDriveFileId: "thumbnail-file", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 20, height: 10, title: "GPU guide", capturedAt: "2026-08-20T09:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z", folderState: "Inbox" },
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
    const { deps } = fixture();
    const response = await publicList(new Request("http://localhost/api/public/infographics"), deps);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual([{ id: infographicId, title: "GPU guide", publishedAt: "2026-08-20T09:00:00.000Z", thumbnailUrl: "/api/public/images/thumbnail-file", imageUrl: "/api/public/images/original-file" }]);
    expect(response.headers?.["cache-control"]).toMatch(/^public/);
    expect(response.headers?.["content-security-policy"]).toContain("default-src 'self'");
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

  test.each([["original-file", "trashed"], ["thumbnail-file", "trashed"], ["original-file", "missing"], ["thumbnail-file", "missing"]] as const)("omits an item whose %s is %s from public DTOs", async (fileId, state) => {
    const { deps, storage } = fixture();
    if (state === "trashed") storage.files.get(fileId)!.file.trashed = true;
    else storage.files.delete(fileId);
    expect(await body(await publicList(new Request("http://localhost/api/public/infographics"), deps))).toEqual([]);
    expect((await publicGet(new Request(`http://localhost/api/public/infographics/${infographicId}`), deps)).status).toBe(404);
  });

  test("refuses an image outside the configured public root and malformed image paths", async () => {
    const { deps } = fixture();
    expect((await publicImage(new Request("http://localhost/api/public/images/private-file"), deps)).status).toBe(404);
    expect((await publicImage(new Request("http://localhost/api/public/images/%2F"), deps)).status).toBe(400);
  });
});
