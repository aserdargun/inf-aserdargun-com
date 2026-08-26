import { randomUUID } from "node:crypto";
import { InfEventSchema, type InfEvent } from "@inf/contracts";
import { ImageProcessingError, processImage } from "../images/process-image.js";
import { EventStore } from "../storage/event-store.js";
import { withKeyedLock } from "../storage/keyed-lock.js";
import type { StoragePort, StoredFile } from "../storage/storage-port.js";
import { publicSafeTitle } from "./capture-service.js";

export interface SyncServiceOptions {
  storage: StoragePort;
  events: EventStore;
  publicRootId: string;
  inboxFolderId: string;
  libraryFolderId: string;
  thumbnailsFolderId: string;
  duplicatesFolderId: string;
  now?: () => Date;
  uuid?: () => string;
}

export interface SyncReport { imported: number; duplicates: number; rejected: number; }

interface SyncHistory { originalIds: Set<string>; rejectedIds: Set<string>; sha256: Set<string>; }

function history(events: unknown[]): SyncHistory {
  const result: SyncHistory = { originalIds: new Set(), rejectedIds: new Set(), sha256: new Set() };
  for (const candidate of events) {
    const parsed = InfEventSchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (parsed.data.type === "infographic.created") {
      result.originalIds.add(parsed.data.payload.originalDriveFileId);
      result.sha256.add(parsed.data.payload.sha256);
    }
    if (parsed.data.type === "sync.fileRejected") result.rejectedIds.add(parsed.data.payload.driveFileId);
  }
  return result;
}

export class SyncService {
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(private readonly options: SyncServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? randomUUID;
  }

  async syncInbox(options: { limit?: number } = {}): Promise<SyncReport> {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 50) throw new Error("Sync limit must be a positive safe integer no greater than 50.");
    const state = history(await this.options.events.readAll());
    const candidates = (await this.options.storage.listChildren(this.options.inboxFolderId))
      .filter((file) => !state.originalIds.has(file.id) && !state.rejectedIds.has(file.id))
      .sort((left, right) => left.createdTime.localeCompare(right.createdTime) || left.id.localeCompare(right.id))
      .slice(0, limit);
    const report: SyncReport = { imported: 0, duplicates: 0, rejected: 0 };
    for (const file of candidates) await this.importOne(file, state, report);
    return report;
  }

  private async importOne(file: StoredFile, state: SyncHistory, report: SyncReport): Promise<void> {
    await withKeyedLock(`file:${file.id}`, async () => {
    const refreshed = history(await this.options.events.readAll());
    if (refreshed.originalIds.has(file.id) || refreshed.rejectedIds.has(file.id)) return;
    state = refreshed;
    let image;
    try {
      image = await processImage({ bytes: await this.options.storage.readFile(file.id), declaredMime: file.mimeType });
    } catch (error) {
      if (!(error instanceof ImageProcessingError)) throw error;
      await this.options.events.append(InfEventSchema.parse({
        eventId: this.uuid(), schemaVersion: 1, type: "sync.fileRejected", occurredAt: this.now().toISOString(),
        payload: { driveFileId: file.id, fileName: file.name, reason: error.code },
      }));
      state.rejectedIds.add(file.id);
      report.rejected += 1;
      return;
    }

    await withKeyedLock(`sha:${image.sha256}`, async () => {
    const current = history(await this.options.events.readAll());
    if (current.originalIds.has(file.id) || current.rejectedIds.has(file.id)) return;
    state = current;
    const matchingFiles = await this.options.storage.findByAppProperty(this.options.publicRootId, "infSha256", image.sha256);
    if (state.sha256.has(image.sha256) || matchingFiles.some((match) => match.id !== file.id)) {
      await this.options.storage.moveFile(file.id, this.options.inboxFolderId, this.options.duplicatesFolderId);
      report.duplicates += 1;
      return;
    }

    const infographicId = this.uuid();
    const timestamp = this.now().toISOString();
    let thumbnail: StoredFile | undefined;
    try {
      thumbnail = await this.options.storage.createFile({
        name: `${infographicId}.webp`, mimeType: image.thumbnailMime, parentId: this.options.thumbnailsFolderId,
        bytes: image.thumbnailBytes, appProperties: { infSha256: image.sha256, infId: infographicId },
      });
      // Manually uploaded files still land in the inbox folder for the sync
      // handshake, but the canonical state is Library: the file is moved into
      // the public Library folder and the create event records Library state.
      await this.options.storage.moveFile(file.id, this.options.inboxFolderId, this.options.libraryFolderId);
      await this.options.events.append(InfEventSchema.parse({
        eventId: this.uuid(), schemaVersion: 1, type: "infographic.created", occurredAt: timestamp, infographicId,
        payload: {
          originalDriveFileId: file.id, thumbnailDriveFileId: thumbnail.id, sha256: image.sha256,
          detectedMimeType: image.detectedMime, width: image.width, height: image.height, title: publicSafeTitle(file.name),
          capturedAt: file.createdTime, createdAt: timestamp, folderState: "Library",
        },
      }) as InfEvent);
      state.originalIds.add(file.id);
      state.sha256.add(image.sha256);
      report.imported += 1;
    } catch (error) {
      if (thumbnail) try { await this.options.storage.trashFile(thumbnail.id); } catch { /* preserve primary error */ }
      throw error;
    }
    });
    });
  }
}
