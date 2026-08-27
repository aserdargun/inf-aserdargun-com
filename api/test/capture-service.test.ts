import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { InfEvent } from "@inf/contracts";
import { CaptureService } from "../src/services/capture-service.js";
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

class MemoryStorage implements StoragePort {
  files = new Map<string, { file: StoredFile; bytes: Buffer }>();
  async listChildren() { return []; }
  async readFile(id: string) { const entry = this.files.get(id); if (!entry) throw new Error("missing"); return Buffer.from(entry.bytes); }
  async createFile(input: CreateFileInput) { const id = (input.fileId ?? `created-${this.files.size + 1}`); const file: StoredFile = { id, name: input.name, mimeType: input.mimeType, createdTime: "2026-08-27T10:00:00.000Z", parentIds: [input.parentId], appProperties: { ...(input.appProperties ?? {}) }, trashed: false }; this.files.set(id, { file, bytes: Buffer.from(input.bytes) }); return file; }
  async moveFile() {} async trashFile() {} async findByAppProperty() { return []; } async isDescendant() { return true; }
}

function setup() {
  const storage = new MemoryStorage();
  const events: InfEvent[] = [];
  const eventStore: Pick<EventStore, "readAll" | "append"> = { readAll: async () => events, append: async (event: InfEvent) => { events.push(event); } };
  const service = new CaptureService({
    storage, events: eventStore as EventStore, publicRootId: ids.public,
    libraryFolderId: ids.library, thumbnailsFolderId: ids.thumbnails,
    now: () => new Date("2026-08-27T10:00:00.000Z"),
    uuid: (() => { let counter = 0; return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`; })(),
  });
  return { service, events, storage };
}

describe("CaptureService atomic taxonomy", () => {
  test("appends infographic.created, categoriesAssigned, and tagsAssigned in a single call when capture ships AI suggestions", async () => {
    const { service, events } = setup();
    const bytes = await fixtureImage();
    const category = { id: "00000000-0000-4000-8000-000000000020", displayName: "AI & Machine Learning", normalizedName: "ai & machine learning", slug: "ai-machine-learning" };
    const tags = [
      { id: "00000000-0000-4000-8000-000000000021", displayName: "memory", normalizedName: "memory", slug: "memory" },
      { id: "00000000-0000-4000-8000-000000000022", displayName: "cuda", normalizedName: "cuda", slug: "cuda" },
    ];
    const result = await service.capture({ bytes, declaredMime: "image/png", name: "loop.png", title: "Understanding LLM inference", notes: "Transformer notes", categories: [category], tags });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.infographicId).toBe("00000000-0000-4000-8000-000000000001");
    expect(result.title).toBe("Understanding LLM inference");

    expect(events.map((event) => event.type)).toEqual([
      "infographic.created",
      "infographic.categoriesAssigned",
      "infographic.tagsAssigned",
    ]);
    const created = events[0]!;
    const categoriesAssigned = events[1]!;
    const tagsAssigned = events[2]!;
    expect(created.type).toBe("infographic.created");
    expect(categoriesAssigned).toMatchObject({ type: "infographic.categoriesAssigned", infographicId: result.infographicId, payload: { categories: [category] } });
    expect(tagsAssigned).toMatchObject({ type: "infographic.tagsAssigned", infographicId: result.infographicId, payload: { tags } });

    // Folding the events yields an infographic whose Library-ready
    // categoryIds and tagIds are populated by the same write — no PATCH
    // is required, so the next read of the catalog surfaces the new
    // metadata immediately.
    const { foldEvents } = await import("@inf/domain");
    const folded = foldEvents(events).catalog.infographics.find((item) => item.id === result.infographicId);
    expect(folded?.categoryIds).toEqual([category.id]);
    expect(folded?.tagIds).toEqual([tags[0]!.id, tags[1]!.id]);
    expect(folded?.folderState).toBe("Library");
  });

  test("only appends the create event when no categories or tags are provided", async () => {
    const { service, events } = setup();
    const bytes = await fixtureImage();
    const result = await service.capture({ bytes, declaredMime: "image/png", name: "loop.png" });
    expect(result.kind).toBe("created");
    expect(events.map((event) => event.type)).toEqual(["infographic.created"]);
  });
});
