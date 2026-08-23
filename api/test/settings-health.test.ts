import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { InfEvent } from "@inf/contracts";
import { ownerSettingsHealth, type OwnerDependencies } from "../src/functions/owner.js";
import type { CreateFileInput, StoredFile, StoragePort } from "../src/storage/storage-port.js";

const ids = { public: "public-root", private: "private-root", inbox: "inbox", library: "library", thumbnails: "thumbnails", duplicates: "duplicates", events: "events" };
const infographicId = "00000000-0000-4000-8000-000000000031";
const auth = { "x-ms-client-principal": Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: "aserdargun" })).toString("base64") };

class Storage implements StoragePort {
  fail = new Set<string>();
  async listChildren(folderId: string): Promise<StoredFile[]> { if (this.fail.has(folderId)) throw new Error("credential=never-leak"); return []; }
  async readFile(): Promise<Buffer> { return Buffer.alloc(0); }
  async createFile(input: CreateFileInput): Promise<StoredFile> { return { id: input.fileId ?? randomUUID(), name: input.name, mimeType: input.mimeType, createdTime: "2026-08-20T10:00:00.000Z", parentIds: [input.parentId], appProperties: {}, trashed: false }; }
  async moveFile(): Promise<void> {} async trashFile(): Promise<void> {} async findByAppProperty(): Promise<StoredFile[]> { return []; }
  async isDescendant(fileId: string, rootId: string): Promise<boolean> { if (this.fail.has(fileId)) throw new Error("refresh_token=never-leak"); return fileId === rootId || (rootId === ids.public && [ids.inbox, ids.library, ids.thumbnails, ids.duplicates].includes(fileId)) || (rootId === ids.private && fileId === ids.events); }
}

function deps(): OwnerDependencies {
  const events: InfEvent[] = [{ eventId: "00000000-0000-4000-8000-000000000032", schemaVersion: 1, type: "infographic.created", occurredAt: "2026-08-20T10:00:00.000Z", infographicId, payload: { originalDriveFileId: "original", thumbnailDriveFileId: "thumbnail", sha256: "a".repeat(64), detectedMimeType: "image/png", width: 20, height: 10, title: "Safe title", notes: "private note", sourceUrl: "https://private.example", capturedAt: "2026-08-20T10:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z", folderState: "Inbox" } }];
  return { storage: new Storage(), events: { readAll: async () => events, append: async () => {} }, publicRootId: ids.public, privateRootId: ids.private, eventsFolderId: ids.events, inboxFolderId: ids.inbox, libraryFolderId: ids.library, thumbnailsFolderId: ids.thumbnails, duplicatesFolderId: ids.duplicates, allowedGithubUser: "aserdargun", now: () => new Date("2026-08-21T10:00:00.000Z") };
}

describe("owner Settings health", () => {
  test("is owner-only, no-store, root-scoped and never serializes secrets or private metadata", async () => {
    const configured = deps();
    expect((await ownerSettingsHealth(new Request("http://localhost/api/settings/health"), configured)).status).toBe(401);
    const response = await ownerSettingsHealth(new Request("http://localhost/api/settings/health", { headers: auth }), configured);
    expect(response.status).toBe(200);
    expect(response.headers?.["cache-control"]).toBe("no-store");
    const body = String(response.body);
    expect(body).toContain('"name":"Infographics"');
    expect(body).toContain(ids.public);
    expect(body).toContain(ids.private);
    expect(body).toContain("original");
    expect(body).not.toMatch(/private note|private\.example|token|secret|credential|aserdargun/i);
  });

  test("degrades folder health and redacts quarantined malformed bodies", async () => {
    const configured = deps();
    (configured.storage as Storage).fail.add(ids.events);
    const bad = "{not-json refresh_token=never-leak}";
    (configured.events.readAll as () => Promise<unknown>) = async () => [bad] as unknown;
    const response = await ownerSettingsHealth(new Request("http://localhost/api/settings/health", { headers: auth }), configured);
    expect(response.status).toBe(200);
    const body = String(response.body);
    expect(body).toContain('"healthy":false');
    expect(body).toContain("invalid-event");
    expect(body).not.toContain("refresh_token");
  });
});
