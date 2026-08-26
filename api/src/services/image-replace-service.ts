import { randomUUID } from "node:crypto";
import { InfEventSchema, InfographicImageReplacedPayloadSchema, type InfEvent, type MaterializedInfographic } from "@inf/contracts";
import { processImage } from "../images/process-image.js";
import { DISABLED_AUTO_TRIM, type AutoTrimConfig } from "../images/trim-options.js";
import { AppError } from "../http/errors.js";
import { withKeyedLock } from "../storage/keyed-lock.js";
import type { EventStore } from "../storage/event-store.js";
import type { StoragePort, StoredFile } from "../storage/storage-port.js";
import { CatalogService } from "./catalog-service.js";
import { safeFileName } from "./capture-service.js";

type InfographicEvent = Exclude<InfEvent, { type: "sync.fileRejected" } | { type: "review.recorded" }>;

export interface ImageReplaceServiceOptions {
  storage: StoragePort;
  events: EventStore;
  publicRootId: string;
  libraryFolderId: string;
  thumbnailsFolderId: string;
  trim?: AutoTrimConfig;
  now?: () => Date;
  uuid?: () => string;
}

export interface ImageReplaceInput {
  infographicId: string;
  bytes: Buffer;
  declaredMime: string;
  name?: string;
}

export interface ImageReplaceResult {
  infographic: MaterializedInfographic;
  original: StoredFile;
  thumbnail: StoredFile;
}

function sha256FromEvents(events: readonly unknown[]): Set<string> {
  const hashes = new Set<string>();
  for (const event of events) {
    const parsed = InfEventSchema.safeParse(event);
    if (!parsed.success) continue;
    if (parsed.data.type === "infographic.created") hashes.add(parsed.data.payload.sha256);
    if (parsed.data.type === "infographic.imageReplaced") hashes.add(parsed.data.payload.sha256);
  }
  return hashes;
}

function filterInfographicEvents(events: readonly unknown[]): InfographicEvent[] {
  const out: InfographicEvent[] = [];
  for (const candidate of events) {
    const parsed = InfEventSchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (parsed.data.type === "sync.fileRejected" || parsed.data.type === "review.recorded") continue;
    out.push(parsed.data as InfographicEvent);
  }
  return out;
}

export class ImageReplaceService {
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly trim: AutoTrimConfig;

  constructor(private readonly options: ImageReplaceServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? randomUUID;
    this.trim = options.trim ?? DISABLED_AUTO_TRIM;
  }

  async replace(input: ImageReplaceInput): Promise<ImageReplaceResult> {
    const image = await processImage({ ...input, trim: this.trim });
    return withKeyedLock(`sha:${image.sha256}`, async () => {
      const existing = await this.options.storage.findByAppProperty(this.options.publicRootId, "infSha256", image.sha256);
      if (existing.some((file) => file.appProperties.infId && file.appProperties.infId !== input.infographicId)) {
        throw new AppError("DUPLICATE_IMAGE", 409, "This image is already in the library.");
      }
      const eventStream = await this.options.events.readAll();
      const infographicShas = new Set<string>();
      for (const event of filterInfographicEvents(eventStream)) {
        if (event.infographicId === input.infographicId && (event.type === "infographic.created" || event.type === "infographic.imageReplaced")) {
          infographicShas.add(event.payload.sha256);
        }
      }
      if (sha256FromEvents(eventStream).has(image.sha256) && !infographicShas.has(image.sha256)) {
        throw new AppError("DUPLICATE_IMAGE", 409, "This image is already in the library.");
      }
      const created: StoredFile[] = [];
      const infographicId = input.infographicId;
      let original: StoredFile | undefined;
      let thumbnail: StoredFile | undefined;
      try {
        const baseAppProps = { infSha256: image.sha256, infId: infographicId };
        const originalAppProps = image.trimApplied
          ? {
              ...baseAppProps,
              infTrimApplied: "1",
              infOriginalWidth: String(image.originalWidth),
              infOriginalHeight: String(image.originalHeight),
              infStoredWidth: String(image.width),
              infStoredHeight: String(image.height),
            }
          : baseAppProps;
        original = await this.options.storage.createFile({
          name: safeFileName(input.name, `${infographicId}.image`),
          mimeType: image.detectedMime,
          parentId: this.options.libraryFolderId,
          bytes: image.originalBytes,
          appProperties: originalAppProps,
        });
        created.push(original);
        thumbnail = await this.options.storage.createFile({
          name: `${infographicId}.webp`,
          mimeType: image.thumbnailMime,
          parentId: this.options.thumbnailsFolderId,
          bytes: image.thumbnailBytes,
          appProperties: { infSha256: image.sha256, infId: infographicId },
        });
        created.push(thumbnail);
        const previous = await this.findCurrentAssets(eventStream, infographicId);
        const event: InfEvent = InfEventSchema.parse({
          eventId: this.uuid(), schemaVersion: 1, type: "infographic.imageReplaced", occurredAt: this.now().toISOString(), infographicId,
          payload: {
            previousOriginalDriveFileId: previous.originalDriveFileId, previousThumbnailDriveFileId: previous.thumbnailDriveFileId,
            originalDriveFileId: original.id, thumbnailDriveFileId: thumbnail.id, sha256: image.sha256,
            detectedMimeType: image.detectedMime, width: image.width, height: image.height,
          },
        });
        InfographicImageReplacedPayloadSchema.parse(event.payload);
        await this.options.events.append(event);
        await this.options.storage.trashFile(previous.originalDriveFileId);
        await this.options.storage.trashFile(previous.thumbnailDriveFileId);
      } catch (error) {
        await Promise.all(created.reverse().map(async (file) => { try { await this.options.storage.trashFile(file.id); } catch { /* cleanup cannot hide the primary error */ } }));
        throw error;
      }
      const snapshot = await new CatalogService(this.options.events).snapshot();
      const infographic = snapshot.infographics.find((candidate) => candidate.id === infographicId);
      if (!infographic) throw new AppError("NOT_FOUND", 404, "Infographic was not found after replace");
      return { infographic, original, thumbnail };
    });
  }

  private async findCurrentAssets(events: readonly unknown[], infographicId: string): Promise<{ originalDriveFileId: string; thumbnailDriveFileId: string }> {
    const sorted = filterInfographicEvents(events)
      .filter((event) => event.infographicId === infographicId)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
    let originalDriveFileId: string | undefined;
    let thumbnailDriveFileId: string | undefined;
    for (const event of sorted) {
      if (event.type === "infographic.created") {
        originalDriveFileId = event.payload.originalDriveFileId;
        thumbnailDriveFileId = event.payload.thumbnailDriveFileId;
      } else if (event.type === "infographic.imageReplaced") {
        originalDriveFileId = event.payload.originalDriveFileId;
        thumbnailDriveFileId = event.payload.thumbnailDriveFileId;
      }
    }
    if (!originalDriveFileId || !thumbnailDriveFileId) throw new AppError("INTEGRITY", 500, "Cannot locate current Drive assets to replace");
    return { originalDriveFileId, thumbnailDriveFileId };
  }
}
