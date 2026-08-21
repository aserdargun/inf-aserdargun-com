import { InfEventSchema, type InfEvent } from "@inf/contracts";
import { withKeyedLock } from "./keyed-lock.js";
import type { StoragePort } from "./storage-port.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export class EventStore {
  constructor(private readonly storage: StoragePort, private readonly eventsFolderId: string, private readonly privateRootId: string) {}

  async append(input: InfEvent): Promise<void> {
    const event = InfEventSchema.parse(input);
    await this.assertPrivateEventsFolder();
    await withKeyedLock(`event:${event.eventId}`, async () => {
      const existing = await this.storage.findByAppProperty(this.eventsFolderId, "infEventId", event.eventId);
      if (existing.length > 0) throw new Error("Duplicate immutable event ID.");
      const bytes = Buffer.from(JSON.stringify(canonicalize(event)), "utf8");
      try {
        await this.storage.createFile({ fileId: event.eventId, name: `${event.eventId}.json`, mimeType: "application/json", parentId: this.eventsFolderId, bytes, appProperties: { infEventId: event.eventId } });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Duplicate immutable event ID.");
        throw error;
      }
      const claims = (await this.storage.findByAppProperty(this.eventsFolderId, "infEventId", event.eventId)).sort((left, right) => left.id.localeCompare(right.id));
      if (claims.length > 1) {
        const winner = claims[0];
        for (const duplicate of claims.slice(1)) {
          const duplicateBytes = await this.storage.readFile(duplicate.id);
          if (!duplicateBytes.equals(bytes)) throw new Error(`Duplicate immutable event ID claim; retained deterministic winner ${winner.id}.`);
          await this.storage.trashFile(duplicate.id);
        }
      }
      if ((await this.storage.findByAppProperty(this.eventsFolderId, "infEventId", event.eventId)).length !== 1) throw new Error("Duplicate immutable event ID claim could not be reconciled.");
    });
  }

  async readAll(): Promise<unknown[]> {
    await this.assertPrivateEventsFolder();
    const files = await this.storage.listChildren(this.eventsFolderId);
    return Promise.all(files.map(async (file) => {
      const bytes = await this.storage.readFile(file.id);
      try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { return { malformedEvent: bytes.toString("utf8") }; }
    }));
  }

  private async assertPrivateEventsFolder(): Promise<void> {
    if (this.eventsFolderId === this.privateRootId || !await this.storage.isDescendant(this.eventsFolderId, this.privateRootId)) {
      throw new Error("Events folder must be a private-root descendant, never a public folder.");
    }
  }
}
