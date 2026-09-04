import { randomUUID } from "node:crypto";
import { InfographicCreatedPayloadSchema, InfEventSchema, type Category, type InfEvent, type Tag } from "@inf/contracts";
import { processImage } from "../images/process-image.js";
import { DISABLED_AUTO_TRIM, type AutoTrimConfig } from "../images/trim-options.js";
import { EventStore } from "../storage/event-store.js";
import { withKeyedLock } from "../storage/keyed-lock.js";
import type { StoragePort, StoredFile } from "../storage/storage-port.js";

export interface CaptureServiceOptions {
  storage: StoragePort;
  events: EventStore;
  publicRootId: string;
  libraryFolderId: string;
  thumbnailsFolderId: string;
  now?: () => Date;
  uuid?: () => string;
  trim?: AutoTrimConfig;
}

export interface CaptureInput {
  bytes: Buffer;
  declaredMime: string;
  name?: string;
  title?: string;
  notes?: string | null;
  /**
   * Optional taxonomy to assign in the same transaction as the create event.
   * Categories and tags land on the new item via `infographic.categoriesAssigned`
   * and `infographic.tagsAssigned` events, so the Library sees them on the
   * very next read with no follow-up PATCH.
   */
  categories?: readonly Category[];
  tags?: readonly Tag[];
  /**
   * Optional AI-suggested content bounding box, expressed as fractions of the
   * source image (0-1). When provided, the image is cropped to this box
   * BEFORE the per-pixel auto-trim runs, so the auto-trim can clean up the
   * AI's box edges if the model was a pixel or two generous. Null/undefined
   * means "no AI crop", and the per-pixel auto-trim is the only crop pass.
   */
  crop?: { top: number; right: number; bottom: number; left: number } | null;
}

export type CaptureResult =
  | { kind: "created"; infographicId: string; title: string; original: StoredFile; thumbnail: StoredFile }
  | { kind: "duplicate"; original: StoredFile | null };

export function publicSafeTitle(input: string | undefined): string {
  const base = (input ?? "").trim().replace(/[\\/]/g, " ").replace(/\.[^.\s]+$/, "");
  const normalized = base.replace(/[\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim();
  return [...(normalized || "Untitled infographic")].slice(0, 200).join("");
}

function safeFileName(name: string | undefined, fallback: string): string {
  const normalized = (name ?? fallback).replace(/[\\/\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, 220);
}

export { safeFileName };

function createdHashes(inputs: unknown[]): Set<string> {
  const hashes = new Set<string>();
  for (const input of inputs) {
    const parsed = InfEventSchema.safeParse(input);
    if (parsed.success && parsed.data.type === "infographic.created") hashes.add(parsed.data.payload.sha256);
  }
  return hashes;
}

export class CaptureService {
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(private readonly options: CaptureServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? randomUUID;
  }

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const image = await processImage({ ...input, crop: input.crop ?? null, trim: this.options.trim ?? DISABLED_AUTO_TRIM });
    return withKeyedLock(`sha:${image.sha256}`, async () => {
      const existing = await this.options.storage.findByAppProperty(this.options.publicRootId, "infSha256", image.sha256);
      if (existing.length > 0 || createdHashes(await this.options.events.readAll()).has(image.sha256)) return { kind: "duplicate", original: existing[0] ?? null };

    const infographicId = this.uuid();
    const title = publicSafeTitle(input.title ?? input.name);
    const timestamp = this.now().toISOString();
    // Every capture lands directly in Library: the Inbox staging folder is
    // gone, so the new item's Drive file and its canonical state are both
    // Library from the first write. Optional categories/tags ship in the
    // same transaction so the Library sees them on the very next read.
    InfographicCreatedPayloadSchema.parse({ originalDriveFileId: "pending", thumbnailDriveFileId: "pending", sha256: image.sha256, detectedMimeType: image.detectedMime, width: image.width, height: image.height, title, notes: input.notes, capturedAt: timestamp, createdAt: timestamp, folderState: "Library" });
    const created: StoredFile[] = [];
    try {
      const original = await this.options.storage.createFile({
        name: safeFileName(input.name, `${infographicId}.image`),
        mimeType: image.detectedMime,
        parentId: this.options.libraryFolderId,
        bytes: image.originalBytes,
        appProperties: { infSha256: image.sha256, infId: infographicId },
      });
      created.push(original);
      const thumbnail = await this.options.storage.createFile({
        name: `${infographicId}.webp`,
        mimeType: image.thumbnailMime,
        parentId: this.options.thumbnailsFolderId,
        bytes: image.thumbnailBytes,
        appProperties: { infSha256: image.sha256, infId: infographicId },
      });
      created.push(thumbnail);
      const events: InfEvent[] = [];
      events.push(InfEventSchema.parse({
        eventId: this.uuid(), schemaVersion: 1, type: "infographic.created", occurredAt: timestamp, infographicId,
        payload: {
          originalDriveFileId: original.id, thumbnailDriveFileId: thumbnail.id, sha256: image.sha256,
          detectedMimeType: image.detectedMime, width: image.width, height: image.height, title,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          capturedAt: timestamp, createdAt: timestamp, folderState: "Library",
        },
      }));
      // Atomic taxonomy: when the client sends categories and/or tags with
      // the capture (e.g. AI-suggested metadata from the Add form), we
      // append the assignment events in the same write. This eliminates the
      // post-capture PATCH and guarantees the new item is fully organized
      // by the time the user lands on the Library.
      const categories = input.categories ?? [];
      if (categories.length > 0) {
        events.push(InfEventSchema.parse({
          eventId: this.uuid(), schemaVersion: 1, type: "infographic.categoriesAssigned", occurredAt: timestamp, infographicId,
          payload: { categories: [...categories] },
        }));
      }
      const tags = input.tags ?? [];
      if (tags.length > 0) {
        events.push(InfEventSchema.parse({
          eventId: this.uuid(), schemaVersion: 1, type: "infographic.tagsAssigned", occurredAt: timestamp, infographicId,
          payload: { tags: [...tags] },
        }));
      }
      for (const event of events) await this.options.events.append(event);
      return { kind: "created", infographicId, title, original, thumbnail };
    } catch (error) {
      await Promise.all(created.reverse().map(async (file) => { try { await this.options.storage.trashFile(file.id); } catch { /* cleanup cannot hide the primary error */ } }));
      throw error;
    }
    });
  }
}
