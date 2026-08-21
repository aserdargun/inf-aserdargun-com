import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { InfEvent } from "@inf/contracts";
import { ownerCapture, ownerDelete, ownerDueReview, ownerGet, ownerList, ownerPatch, ownerReview, ownerSeen, ownerSession, ownerStats, ownerSurprise, ownerSync, type OwnerDependencies } from "../src/functions/owner.js";
import type { StoragePort, StoredFile, CreateFileInput } from "../src/storage/storage-port.js";

const ids = { public: "public", private: "private", events: "events", inbox: "inbox", thumbnails: "thumbnails", duplicates: "duplicates" };
const infographicId = "00000000-0000-4000-8000-000000000001";
const authorizingHeader = { "x-ms-client-principal": Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: "aserdargun" })).toString("base64") };
const apiRoot = process.cwd().endsWith("/api") ? process.cwd() : resolve(process.cwd(), "api");

class MemoryStorage implements StoragePort {
  readonly files = new Map<string, { file: StoredFile; bytes: Buffer }>();
  trashed: string[] = [];
  async listChildren(folderId: string) { return [...this.files.values()].map(({ file }) => file).filter((file) => file.parentIds.includes(folderId) && !file.trashed); }
  async readFile(fileId: string) { const value = this.files.get(fileId); if (!value) throw new Error("missing"); return Buffer.from(value.bytes); }
  async createFile(input: CreateFileInput) { const id = input.fileId ?? randomUUID(); const file = { id, name: input.name, mimeType: input.mimeType, createdTime: "2026-08-21T10:00:00.000Z", parentIds: [input.parentId], appProperties: { ...(input.appProperties ?? {}) }, trashed: false }; this.files.set(id, { file, bytes: Buffer.from(input.bytes) }); return file; }
  async moveFile(fileId: string, from: string, to: string) { const value = this.files.get(fileId); if (!value || value.file.parentIds[0] !== from) throw new Error("missing"); value.file.parentIds = [to]; }
  async trashFile(fileId: string) { const value = this.files.get(fileId); if (!value) throw new Error("missing"); value.file.trashed = true; this.trashed.push(fileId); }
  async findByAppProperty(rootId: string, key: string, value: string) { return [...this.files.values()].map(({ file }) => file).filter((file) => !file.trashed && file.appProperties[key] === value && rootId === ids.public); }
  async isDescendant() { return true; }
}

function createdEvent(): InfEvent { return { eventId: "00000000-0000-4000-8000-000000000002", schemaVersion: 1, type: "infographic.created", occurredAt: "2026-08-20T10:00:00.000Z", infographicId, payload: { originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 20, height: 10, title: "GPU guide", notes: "private", sourceUrl: "https://example.com", capturedAt: "2026-08-20T09:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z", folderState: "Inbox" } }; }

function fixture(): { deps: OwnerDependencies; events: InfEvent[]; storage: MemoryStorage } {
  const events = [createdEvent()]; const storage = new MemoryStorage();
  storage.files.set("original", { file: { id: "original", name: "a.png", mimeType: "image/png", createdTime: "2026-08-20T09:00:00.000Z", parentIds: [ids.inbox], appProperties: {}, trashed: false }, bytes: Buffer.from("image") });
  storage.files.set("thumbnail", { file: { id: "thumbnail", name: "a.webp", mimeType: "image/webp", createdTime: "2026-08-20T09:00:00.000Z", parentIds: [ids.thumbnails], appProperties: {}, trashed: false }, bytes: Buffer.from("thumbnail") });
  const eventStore = { readAll: async () => events, append: async (event: InfEvent) => { events.push(event); } };
  const uuid = (() => { let n = 10; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })();
  return { events, storage, deps: { storage, events: eventStore, publicRootId: ids.public, inboxFolderId: ids.inbox, thumbnailsFolderId: ids.thumbnails, duplicatesFolderId: ids.duplicates, privateRootId: ids.private, eventsFolderId: ids.events, allowedGithubUser: "aserdargun", now: () => new Date("2026-08-21T10:00:00.000Z"), uuid } };
}

const request = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, { ...init, headers: { ...authorizingHeader, ...init.headers } });
const json = async (response: { body?: string | Buffer }) => JSON.parse(String(response.body));

describe("owner HTTP API", () => {
  test("distinguishes missing identity (401), non-owner (403), and owner session (200)", async () => {
    const { deps } = fixture();
    expect((await ownerSession(new Request("http://localhost/api/session"), deps)).status).toBe(401);
    expect((await ownerSession(new Request("http://localhost/api/session", { headers: { "x-ms-client-principal": Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: "other" })).toString("base64") } }), deps)).status).toBe(403);
    const response = await ownerSession(request("/api/session"), deps);
    expect(response.status).toBe(200); expect(await json(response)).toMatchObject({ authenticated: true, owner: "aserdargun" });
  });

  test("lists and gets private owner catalog only after authorization with no-store security headers", async () => {
    const { deps } = fixture();
    const list = await ownerList(request("/api/infographics"), deps);
    expect(await json(list)).toMatchObject({ infographics: [expect.objectContaining({ id: infographicId, notes: "private" })] });
    expect(list.headers).toMatchObject({ "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
    expect((await ownerGet(request("/api/infographics/not-a-uuid"), deps)).status).toBe(400);
    expect((await ownerGet(request(`/api/infographics/${infographicId}`), deps)).status).toBe(200);
  });

  test("rejects malformed sync, patch, delete, review, and multipart capture input", async () => {
    const { deps } = fixture();
    expect((await ownerSync(request("/api/sync", { method: "POST", body: "no", headers: { ...authorizingHeader, "content-type": "application/json" } }), deps)).status).toBe(400);
    expect((await ownerPatch(request(`/api/infographics/${infographicId}`, { method: "PATCH", body: "{}", headers: { ...authorizingHeader, "content-type": "application/json" } }), deps)).status).toBe(400);
    expect((await ownerDelete(request(`/api/infographics/${infographicId}`, { method: "DELETE", body: JSON.stringify({ confirm: false }), headers: { ...authorizingHeader, "content-type": "application/json" } }), deps)).status).toBe(400);
    expect((await ownerReview(request(`/api/infographics/${infographicId}/reviews`, { method: "POST", body: JSON.stringify({ rating: "bad" }), headers: { ...authorizingHeader, "content-type": "application/json" } }), deps)).status).toBe(400);
    expect((await ownerCapture(request("/api/infographics", { method: "POST", body: "not multipart", headers: { ...authorizingHeader, "content-type": "text/plain" } }), deps)).status).toBe(400);
  });

  test("captures a valid multipart image and never accepts a file field with invalid metadata", async () => {
    const { deps, events } = fixture();
    const form = new FormData(); form.set("title", "Captured chart"); form.set("notes", "private note");
    form.set("file", new File([await readFile(resolve(apiRoot, "test/fixtures/valid-infographic.png"))], "chart.png", { type: "image/png" }));
    const response = await ownerCapture(request("/api/infographics", { method: "POST", body: form }), deps);
    expect(response.status).toBe(201); expect(await json(response)).toMatchObject({ kind: "created", title: "Captured chart" });
    expect(events.at(-1)).toMatchObject({ type: "infographic.created", payload: { notes: "private note" } });

    const invalid = new FormData(); invalid.set("sourceUrl", "not a url"); invalid.set("file", new File([Buffer.from("x")], "chart.png", { type: "image/png" }));
    expect((await ownerCapture(request("/api/infographics", { method: "POST", body: invalid }), deps)).status).toBe(400);
    const undecodable = new FormData(); undecodable.set("file", new File([Buffer.from("not an image")], "chart.png", { type: "image/png" }));
    expect((await ownerCapture(request("/api/infographics", { method: "POST", body: undecodable }), deps)).status).toBe(400);
  });

  test("syncs, patches immutable metadata, records seen and calculated review state", async () => {
    const { deps, events } = fixture();
    expect(await json(await ownerSync(request("/api/sync", { method: "POST", body: JSON.stringify({ limit: 1 }), headers: { ...authorizingHeader, "content-type": "application/json" } }), deps))).toEqual({ imported: 0, duplicates: 0, rejected: 0 });
    expect((await ownerPatch(request(`/api/infographics/${infographicId}`, { method: "PATCH", body: JSON.stringify({ title: "Updated title", favorite: true }), headers: { ...authorizingHeader, "content-type": "application/json" } }), deps)).status).toBe(200);
    expect((await ownerSeen(request(`/api/infographics/${infographicId}/seen`, { method: "POST" }), deps)).status).toBe(204);
    const review = await ownerReview(request(`/api/infographics/${infographicId}/reviews`, { method: "POST", body: JSON.stringify({ rating: "good" }), headers: { ...authorizingHeader, "content-type": "application/json" } }), deps);
    expect(await json(review)).toMatchObject({ rating: "good", previousIntervalDays: null, intervalDays: 7, dueAt: "2026-08-28T10:00:00.000Z" });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["infographic.metadataUpdated", "infographic.favoriteChanged", "infographic.seen", "review.recorded"]));
  });

  test("returns deterministic surprise, due reviews, stats, and trashes files only after confirmed delete", async () => {
    const { deps, storage, events } = fixture();
    expect((await ownerSurprise(request("/api/surprise"), deps)).status).toBe(200);
    expect(await json(await ownerDueReview(request("/api/review"), deps))).toEqual({ infographics: [] });
    expect(await json(await ownerStats(request("/api/settings/stats"), deps))).toMatchObject({ total: 1, inbox: 1, due: 0 });
    expect((await ownerDelete(request(`/api/infographics/${infographicId}`, { method: "DELETE", body: JSON.stringify({ confirm: true }), headers: { ...authorizingHeader, "content-type": "application/json" } }), deps)).status).toBe(204);
    expect(storage.trashed.sort()).toEqual(["original", "thumbnail"]);
    expect(events.at(-1)?.type).toBe("infographic.deleted");
  });
});
