import type { CreateFileInput, StoragePort, StoredFile } from "../storage/storage-port.js";
import { LruCache } from "./lru-cache.js";

export interface CachedStorageOptions {
  /** TTL for `isDescendant` answers; brief because tree ancestry rarely changes during a page load. */
  readonly descentTtlMs: number;
  /** TTL for raw image bytes; longer because images are content-addressed and effectively immutable in this system. */
  readonly fileTtlMs: number;
  /** LRU cap for the descent cache (boolean answers). */
  readonly descentMaxEntries: number;
  /** LRU cap for the file cache (binary buffers, can be large). */
  readonly fileMaxEntries: number;
}

/**
 * Read-through cache for the expensive hot paths of public read traffic.
 *
 * `isDescendant` is a recursive Drive `files.get` walk; `readFile` downloads the
 * binary. Both are read-only relative to public root content during the lifetime
 * of a public viewer request. Mutations (`createFile`, `moveFile`, `trashFile`)
 * invalidate affected keys so the next read sees consistent state.
 *
 * The cache is intentionally NOT shared across Functions instances; the TTLs are
 * tuned to absorb a single page-load's worth of concurrent reads.
 */
export class CachedStorage implements StoragePort {
  private readonly descent: LruCache<boolean>;
  private readonly files: LruCache<Buffer>;
  private readonly pendingFiles = new Map<string, Promise<Buffer>>();
  private readonly pendingDescent = new Map<string, Promise<boolean>>();
  private revision = 0;

  constructor(private readonly inner: StoragePort, options: CachedStorageOptions) {
    if (options.descentTtlMs <= 0 || options.fileTtlMs <= 0) throw new Error("CachedStorage TTLs must be positive.");
    this.descent = new LruCache<boolean>({ maxEntries: options.descentMaxEntries, defaultTtlMs: options.descentTtlMs });
    this.files = new LruCache<Buffer>({ maxEntries: options.fileMaxEntries, defaultTtlMs: options.fileTtlMs });
  }

  async listChildren(folderId: string): Promise<StoredFile[]> { return this.inner.listChildren(folderId); }

  async readFile(fileId: string): Promise<Buffer> {
    const cached = this.files.get(fileId);
    if (cached) return cached;
    const existing = this.pendingFiles.get(fileId);
    if (existing) return existing;
    const revision = this.revision;
    const pending = this.inner.readFile(fileId).then((value) => {
      if (revision === this.revision) this.files.set(fileId, value);
      return value;
    }).finally(() => {
      if (this.pendingFiles.get(fileId) === pending) this.pendingFiles.delete(fileId);
    });
    this.pendingFiles.set(fileId, pending);
    return pending;
  }

  async createFile(input: CreateFileInput): Promise<StoredFile> {
    const created = await this.inner.createFile(input);
    this.invalidateForFile(created.id);
    return created;
  }

  async moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    this.invalidateForFile(fileId);
    try { await this.inner.moveFile(fileId, fromFolderId, toFolderId); }
    finally { this.invalidateForFile(fileId); }
  }

  async trashFile(fileId: string): Promise<void> {
    this.invalidateForFile(fileId);
    try { await this.inner.trashFile(fileId); }
    finally { this.invalidateForFile(fileId); }
  }

  async findByAppProperty(rootId: string, key: string, value: string): Promise<StoredFile[]> {
    return this.inner.findByAppProperty(rootId, key, value);
  }

  async isDescendant(fileId: string, rootId: string): Promise<boolean> {
    const key = `desc:${rootId}:${fileId}`;
    const cached = this.descent.get(key);
    if (cached !== undefined) return cached;
    const existing = this.pendingDescent.get(key);
    if (existing) return existing;
    const revision = this.revision;
    const pending = this.inner.isDescendant(fileId, rootId).then((value) => {
      if (revision === this.revision) this.descent.set(key, value);
      return value;
    }).finally(() => {
      if (this.pendingDescent.get(key) === pending) this.pendingDescent.delete(key);
    });
    this.pendingDescent.set(key, pending);
    return pending;
  }

  /** Diagnostics for the few places that surface cache hit ratios. */
  describe(): { descentHits: number; descentMisses: number; descentSize: number; fileHits: number; fileMisses: number; fileSize: number } {
    return {
      descentHits: this.descent.hits, descentMisses: this.descent.misses, descentSize: this.descent.size,
      fileHits: this.files.hits, fileMisses: this.files.misses, fileSize: this.files.size,
    };
  }

  private invalidateForFile(fileId: string): void {
    this.revision += 1;
    this.files.delete(fileId);
    this.pendingFiles.delete(fileId);
    // A moved folder can change the ancestry of every cached descendant.
    this.descent.clear();
    this.pendingDescent.clear();
  }
}
