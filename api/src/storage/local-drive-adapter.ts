import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { CreateFileInput, StoragePort, StoredFile } from "./storage-port.js";
import { withKeyedLock } from "./keyed-lock.js";

interface LocalMetadataRecord {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  appProperties: Record<string, string>;
}

interface LocalMetadata extends StoredFile {
  bundlePath: string;
}

type FaultStep = "beforeDataPublish" | "afterDataPublish" | "beforeMetadataPublish" | "afterMetadataPublish" | "afterSourceMetadataRemove" | "afterSourceDataRemove" | "beforeSourceRestore";

export interface LocalDriveAdapterOptions {
  rootPath?: string;
  folderPaths: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  fault?: (step: FaultStep) => void;
}

const bundleSuffix = ".inf-bundle";
const validName = (value: string) => value.length > 0 && value.length <= 240 && value === basename(value) && !value.includes("\\") && !value.includes("\0");
const copyFile = (file: StoredFile): StoredFile => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  createdTime: file.createdTime,
  parentIds: [...file.parentIds],
  appProperties: { ...file.appProperties },
  trashed: file.trashed,
});

function destinationConflict(cause: unknown): NodeJS.ErrnoException {
  const error = new Error("Local storage destination already exists; refusing to overwrite a non-empty bundle.", { cause }) as NodeJS.ErrnoException;
  error.code = "EEXIST";
  return error;
}

export class LocalDriveAdapter implements StoragePort {
  private readonly rootPath: string;
  private readonly folderPaths: Map<string, string>;
  private readonly fault: LocalDriveAdapterOptions["fault"];

  constructor(options: LocalDriveAdapterOptions) {
    this.rootPath = resolve(options.rootPath ?? process.env.INF_LOCAL_STORAGE_ROOT ?? ".inf-local-storage");
    this.fault = options.fault;
    this.folderPaths = new Map(options.folderPaths instanceof Map ? options.folderPaths : Object.entries(options.folderPaths));
    for (const [id, path] of this.folderPaths) {
      if (!id || !path || resolve(this.rootPath, path) === this.rootPath && path !== ".") throw new Error("Configured folder IDs must map to paths below the local storage root.");
      this.safePath(path);
    }
  }

  async listChildren(folderId: string): Promise<StoredFile[]> {
    const path = await this.folderPath(folderId);
    const metadata = await this.metadataIn(path);
    return metadata.filter((item) => !item.trashed && item.parentIds.includes(folderId)).map(copyFile);
  }

  async readFile(fileId: string): Promise<Buffer> {
    const metadata = await this.requireMetadata(fileId);
    return Buffer.from(await readFile(resolve(metadata.bundlePath, "data")));
  }

  async createFile(input: CreateFileInput): Promise<StoredFile> {
    if (!validName(input.name)) throw new Error("File name must be a single safe name.");
    if (!Buffer.isBuffer(input.bytes)) throw new TypeError("File bytes must be a Buffer.");
    const parentPath = await this.folderPath(input.parentId);
    const id = input.fileId ?? randomUUID();
    if (!validName(id)) throw new Error("File ID must be a safe name.");
    const destination = resolve(parentPath, `${id}${bundleSuffix}`);
    this.assertInside(parentPath, destination);
    const operationsRoot = resolve(this.rootPath, ".operations");
    await this.ensureSafeDirectory(operationsRoot);
    const operation = resolve(operationsRoot, randomUUID());
    await mkdir(operation, { mode: 0o700 });
    const record: LocalMetadataRecord = {
      id,
      name: input.name,
      mimeType: input.mimeType,
      createdTime: new Date().toISOString(),
      appProperties: { ...(input.appProperties ?? {}) },
    };
    try {
      await writeFile(resolve(operation, "data"), Buffer.from(input.bytes), { flag: "wx", mode: 0o600 });
      await writeFile(resolve(operation, "metadata.json"), JSON.stringify(record), { flag: "wx", mode: 0o600 });
      // The complete non-empty bundle becomes visible with one atomic pathname
      // publication. A non-empty foreign destination cannot be replaced by rename.
      await rename(operation, destination);
    } catch (error) {
      await rm(operation, { recursive: true, force: true }).catch(() => undefined);
      if (["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw destinationConflict(error);
      throw error;
    }
    return copyFile({ ...record, parentIds: [input.parentId], trashed: false });
  }

  async moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    await withKeyedLock(`local:${fileId}`, async () => {
      const metadata = await this.requireMetadata(fileId);
      if (metadata.trashed || metadata.parentIds.length !== 1 || metadata.parentIds[0] !== fromFolderId) throw new Error("File does not have the requested current parent.");
      const fromPath = await this.folderPath(fromFolderId);
      const toPath = await this.folderPath(toFolderId);
      this.assertInside(fromPath, metadata.bundlePath);
      const destination = resolve(toPath, `${fileId}${bundleSuffix}`);
      this.assertInside(toPath, destination);
      await this.publish(metadata, destination);
    });
  }

  async trashFile(fileId: string): Promise<void> {
    await withKeyedLock(`local:${fileId}`, async () => {
      const metadata = await this.requireMetadata(fileId);
      if (metadata.trashed) return;
      const trashPath = resolve(this.rootPath, ".trash");
      this.assertInside(this.rootPath, trashPath);
      await this.ensureSafeDirectory(trashPath);
      await this.publish(metadata, resolve(trashPath, `${fileId}${bundleSuffix}`));
    });
  }

  async findByAppProperty(rootId: string, key: string, value: string): Promise<StoredFile[]> {
    this.validateProperty(key, value);
    const rootPath = await this.folderPath(rootId);
    const files = await this.metadataUnder(rootPath);
    return files.filter((item) => !item.trashed && item.appProperties[key] === value).map(copyFile);
  }

  async isDescendant(fileId: string, rootId: string): Promise<boolean> {
    const rootPath = await this.folderPath(rootId);
    if (fileId === rootId) return true;
    if (this.folderPaths.has(fileId)) return this.isPathUnder(rootPath, await this.folderPath(fileId));
    const metadata = await this.requireMetadata(fileId);
    return !metadata.trashed && this.isPathUnder(rootPath, metadata.bundlePath);
  }

  private async folderPath(folderId: string): Promise<string> {
    const path = this.folderPaths.get(folderId);
    if (path === undefined) throw new Error("Folder ID is not a configured local storage root.");
    const resolved = this.safePath(path);
    return this.ensureSafeDirectory(resolved);
  }

  private safePath(path: string): string {
    const resolved = resolve(this.rootPath, path);
    this.assertInside(this.rootPath, resolved);
    return resolved;
  }

  private assertInside(root: string, candidate: string): void {
    if (!this.isPathUnder(root, candidate)) throw new Error("Local storage path escapes its configured root.");
  }

  private isPathUnder(root: string, candidate: string): boolean {
    const relation = relative(resolve(root), resolve(candidate));
    return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !relation.startsWith(".."));
  }

  private assertNoLegacyEntries(names: string[]): void {
    if (names.some((name) => name.endsWith(".blob") || name.endsWith(".inf-meta.json"))) throw new Error("Legacy split-pair local storage detected; Stop INF, reset the ignored local storage tree, and run again.");
  }

  private async metadataIn(path: string): Promise<LocalMetadata[]> {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isSymbolicLink())) throw new Error("Local storage directory contains a symlink.");
    this.assertNoLegacyEntries(entries.map((entry) => entry.name));
    return Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(bundleSuffix)).map((entry) => this.readBundle(resolve(path, entry.name))));
  }

  private async metadataUnder(path: string): Promise<LocalMetadata[]> {
    if (basename(path) === ".operations") return [];
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isSymbolicLink())) throw new Error("Local storage directory contains a symlink.");
    this.assertNoLegacyEntries(entries.map((entry) => entry.name));
    const groups = await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return [];
      if (entry.name === ".operations") return [];
      const child = resolve(path, entry.name);
      return entry.name.endsWith(bundleSuffix) ? [await this.readBundle(child)] : this.metadataUnder(child);
    }));
    return groups.flat();
  }

  private async readBundle(bundlePath: string): Promise<LocalMetadata> {
    const bundleInfo = await lstat(bundlePath);
    if (bundleInfo.isSymbolicLink() || !bundleInfo.isDirectory()) throw new Error("Local storage bundle is unsafe.");
    const entries = await readdir(bundlePath, { withFileTypes: true });
    if (entries.some((entry) => entry.isSymbolicLink() || !entry.isFile()) || entries.map((entry) => entry.name).sort().join("\n") !== "data\nmetadata.json") throw new Error("Local storage bundle must contain exactly safe data and metadata files.");
    const metadataPath = resolve(bundlePath, "metadata.json");
    const dataPath = resolve(bundlePath, "data");
    const [metadataInfo, dataInfo] = await Promise.all([lstat(metadataPath), lstat(dataPath)]);
    if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || !dataInfo.isFile() || dataInfo.isSymbolicLink()) throw new Error("Local storage bundle is unsafe.");
    const raw: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
    if (!raw || typeof raw !== "object") throw new Error("Local storage metadata is malformed.");
    const item = raw as LocalMetadataRecord;
    if (!validName(item.id) || !validName(item.name) || typeof item.mimeType !== "string" || !Number.isFinite(Date.parse(item.createdTime)) || !item.appProperties || typeof item.appProperties !== "object" || !Object.values(item.appProperties).every((value) => typeof value === "string")) throw new Error("Local storage metadata is malformed.");
    if (basename(bundlePath) !== `${item.id}${bundleSuffix}`) throw new Error("Local storage bundle name does not match its metadata.");
    this.assertInside(this.rootPath, bundlePath);
    const parentPath = dirname(bundlePath);
    const trashed = resolve(parentPath) === resolve(this.rootPath, ".trash");
    const parentId = trashed ? undefined : this.folderIdForPath(parentPath);
    if (!trashed && !parentId) throw new Error("Local storage metadata parent does not match its bundle directory.");
    return { ...item, parentIds: parentId ? [parentId] : [], trashed, bundlePath };
  }

  private async requireMetadata(fileId: string): Promise<LocalMetadata> {
    if (!validName(fileId)) throw new Error("File ID must be a safe name.");
    const found = (await this.metadataUnder(this.rootPath)).filter((item) => item.id === fileId);
    if (found.length !== 1) throw new Error("File was not found in local storage.");
    if (found[0].trashed) throw new Error("Local storage file is trashed and recoverable, not readable.");
    return found[0];
  }

  private validateProperty(key: string, value: string): void {
    if (!key || !value || key.length > 128 || value.length > 512) throw new Error("App property key and value must be bounded non-empty strings.");
  }

  private async ensureSafeDirectory(path: string): Promise<string> {
    const root = resolve(this.rootPath);
    this.assertInside(root, path);
    try { await mkdir(root, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Local storage root is unsafe.");
    const realRoot = await realpath(root);
    let current = root;
    for (const segment of relative(root, path).split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      try { await lstat(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try { await mkdir(current, { mode: 0o700 }); } catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError; }
      }
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Local storage configured folder contains a symlink or non-directory.");
      this.assertInside(realRoot, await realpath(current));
    }
    return path;
  }

  private folderIdForPath(path: string): string | undefined {
    return [...this.folderPaths.entries()].find(([, relativePath]) => resolve(this.rootPath, relativePath) === resolve(path))?.[0];
  }

  private async assertSourceUnclaimed(path: string): Promise<void> {
    try { await lstat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Error("Foreign source bundle detected after the atomic claim.");
  }

  private async publish(metadata: LocalMetadata, destination: string): Promise<void> {
    const source = metadata.bundlePath;
    const operationsRoot = resolve(this.rootPath, ".operations");
    await this.ensureSafeDirectory(operationsRoot);
    const operation = resolve(operationsRoot, randomUUID());
    // One rename claims data and metadata together. The complete source bundle
    // is never split into independently reusable caller-visible pathnames.
    await rename(source, operation);
    try {
      // Compatibility fault labels all remain pre-commit. The immutable bundle
      // record derives parent and trash state from its single published path.
      this.fault?.("beforeDataPublish");
      this.fault?.("afterDataPublish");
      this.fault?.("beforeMetadataPublish");
      this.fault?.("afterSourceMetadataRemove");
      this.fault?.("afterSourceDataRemove");
      this.fault?.("afterMetadataPublish");
      await this.assertSourceUnclaimed(source);
      try { await rename(operation, destination); }
      catch (error) {
        if (["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw destinationConflict(error);
        throw error;
      }
      // Final rename is the last operation; there is no fallible shared-path
      // cleanup after irreversible destination publication.
    } catch (error) {
      try { this.fault?.("beforeSourceRestore"); }
      catch (boundaryError) { throw new AggregateError([error, boundaryError], `Local storage rollback boundary failed; original whole bundle retained in quarantine ${operation}`); }
      try { await rename(operation, source); }
      catch (restoreError) { throw new AggregateError([error, restoreError], `Foreign source bundle preserved; original whole bundle retained in quarantine ${operation}`); }
      throw error;
    }
  }
}
