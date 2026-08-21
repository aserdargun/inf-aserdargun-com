import { randomUUID } from "node:crypto";
import { InfEventSchema, type InfEvent } from "@inf/contracts";
import { processImage } from "../images/process-image.js";
import { EventStore } from "../storage/event-store.js";
import type { StoragePort, StoredFile } from "../storage/storage-port.js";

export interface CaptureServiceOptions {
  storage: StoragePort;
  events: EventStore;
  publicRootId: string;
  inboxFolderId: string;
  thumbnailsFolderId: string;
  now?: () => Date;
  uuid?: () => string;
}

export interface CaptureInput {
  bytes: Buffer;
  declaredMime: string;
  name?: string;
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
    const image = await processImage(input);
    const existing = await this.options.storage.findByAppProperty(this.options.publicRootId, "infSha256", image.sha256);
    if (existing.length > 0 || createdHashes(await this.options.events.readAll()).has(image.sha256)) {
      return { kind: "duplicate", original: existing[0] ?? null };
    }

    const infographicId = this.uuid();
    const title = publicSafeTitle(input.name);
    const timestamp = this.now().toISOString();
    const created: StoredFile[] = [];
    try {
      const original = await this.options.storage.createFile({
        name: safeFileName(input.name, `${infographicId}.image`),
        mimeType: image.detectedMime,
        parentId: this.options.inboxFolderId,
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
      const event: InfEvent = InfEventSchema.parse({
        eventId: this.uuid(), schemaVersion: 1, type: "infographic.created", occurredAt: timestamp, infographicId,
        payload: {
          originalDriveFileId: original.id, thumbnailDriveFileId: thumbnail.id, sha256: image.sha256,
          detectedMimeType: image.detectedMime, width: image.width, height: image.height, title,
          capturedAt: timestamp, createdAt: timestamp, folderState: "Inbox",
        },
      });
      await this.options.events.append(event);
      return { kind: "created", infographicId, title, original, thumbnail };
    } catch (error) {
      await Promise.all(created.reverse().map(async (file) => { try { await this.options.storage.trashFile(file.id); } catch { /* cleanup cannot hide the primary error */ } }));
      throw error;
    }
  }
}
