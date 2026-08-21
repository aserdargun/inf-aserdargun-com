import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { CreateFileInput, StoragePort, StoredFile } from "./storage-port.js";
import { withKeyedLock } from "./keyed-lock.js";

interface LocalMetadata extends StoredFile {
  trashed: boolean;
  dataPath: string;
}

export interface LocalDriveAdapterOptions {
  rootPath?: string;
  folderPaths: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  fault?: (step: "beforeDataPublish" | "afterDataPublish" | "beforeMetadataPublish" | "afterMetadataPublish" | "afterSourceMetadataRemove" | "afterSourceDataRemove") => void;
}

const sidecarSuffix = ".inf-meta.json";
const validName = (value: string) => value.length > 0 && value.length <= 240 && value === basename(value) && !value.includes("\\") && !value.includes("\0");
const copyFile = (file: StoredFile): StoredFile => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  createdTime: file.createdTime,
  parentIds: [...file.parentIds],
  appProperties: { ...file.appProperties },
  trashed: (file as LocalMetadata).trashed ?? false,
});

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
    return Buffer.from(await readFile(metadata.dataPath));
  }

  async createFile(input: CreateFileInput): Promise<StoredFile> {
    if (!validName(input.name)) throw new Error("File name must be a single safe name.");
    if (!Buffer.isBuffer(input.bytes)) throw new TypeError("File bytes must be a Buffer.");
    const parentPath = await this.folderPath(input.parentId);
    const id = input.fileId ?? randomUUID();
    if (!validName(id)) throw new Error("File ID must be a safe name.");
    const dataPath = resolve(parentPath, input.fileId ? input.name : `${id}.blob`);
    this.assertInside(parentPath, dataPath);
    const metadataPath = `${dataPath}${sidecarSuffix}`;
    const metadata: LocalMetadata = {
      id,
      name: input.name,
      mimeType: input.mimeType,
      createdTime: new Date().toISOString(),
      parentIds: [input.parentId],
      appProperties: { ...(input.appProperties ?? {}) },
      trashed: false,
      dataPath,
    };
    // Exclusive creation never replaces a pre-existing object.
    await writeFile(dataPath, Buffer.from(input.bytes), { flag: "wx", mode: 0o600 });
    try { await writeFile(metadataPath, JSON.stringify(metadata), { flag: "wx", mode: 0o600 }); } catch (error) {
      await unlink(dataPath).catch(() => undefined);
      throw error;
    }
    return copyFile(metadata);
  }

  async moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    await withKeyedLock(`local:${fileId}`, async () => {
    const metadata = await this.requireMetadata(fileId);
    if (metadata.trashed || metadata.parentIds.length !== 1 || metadata.parentIds[0] !== fromFolderId) {
      throw new Error("File does not have the requested current parent.");
    }
    const fromPath = await this.folderPath(fromFolderId);
    const toPath = await this.folderPath(toFolderId);
    this.assertInside(fromPath, metadata.dataPath);
    const destination = resolve(toPath, `${fileId}.blob`);
    this.assertInside(toPath, destination);
    await this.assertAbsent(`${destination}${sidecarSuffix}`);
    await this.publish(metadata, destination, { parentIds: [toFolderId], dataPath: destination, trashed: false });
    });
  }

  async trashFile(fileId: string): Promise<void> {
    await withKeyedLock(`local:${fileId}`, async () => {
    const metadata = await this.requireMetadata(fileId);
    if (metadata.trashed) return;
    const trashPath = resolve(this.rootPath, ".trash");
    this.assertInside(this.rootPath, trashPath);
    await this.ensureSafeDirectory(trashPath);
    const destination = resolve(trashPath, `${fileId}.blob`);
    await this.assertAbsent(`${destination}${sidecarSuffix}`);
    await this.publish(metadata, destination, { parentIds: metadata.parentIds, dataPath: destination, trashed: true });
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
    return !metadata.trashed && this.isPathUnder(rootPath, metadata.dataPath);
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

  private async metadataIn(path: string): Promise<LocalMetadata[]> {
    const names = await readdir(path).catch(() => [] as string[]);
    return Promise.all(names.filter((name) => name.endsWith(sidecarSuffix)).map((name) => this.readMetadata(resolve(path, name))));
  }

  private async metadataUnder(path: string): Promise<LocalMetadata[]> {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isSymbolicLink())) throw new Error("Local storage directory contains a symlink.");
    const groups = await Promise.all(entries.map(async (entry) => entry.isDirectory()
      ? this.metadataUnder(resolve(path, entry.name))
      : entry.name.endsWith(sidecarSuffix) ? [await this.readMetadata(resolve(path, entry.name))] : []));
    return groups.flat();
  }

  private async readMetadata(path: string): Promise<LocalMetadata> {
    const sidecarStat = await lstat(path);
    if (sidecarStat.isSymbolicLink() || !sidecarStat.isFile()) throw new Error("Local storage metadata sidecar is unsafe.");
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!raw || typeof raw !== "object") throw new Error("Local storage metadata is malformed.");
    const item = raw as LocalMetadata;
    if (!validName(item.id) || !validName(item.name) || typeof item.mimeType !== "string" || !Number.isFinite(Date.parse(item.createdTime)) || !Array.isArray(item.parentIds) || item.parentIds.length !== 1 || !item.parentIds.every((parent) => typeof parent === "string" && parent.length > 0) || !item.appProperties || typeof item.appProperties !== "object" || !Object.values(item.appProperties).every((value) => typeof value === "string") || typeof item.trashed !== "boolean" || typeof item.dataPath !== "string") {
      throw new Error("Local storage metadata is malformed.");
    }
    this.assertInside(this.rootPath, item.dataPath);
    const dataStat = await lstat(item.dataPath);
    if (dataStat.isSymbolicLink() || !dataStat.isFile()) throw new Error("Local storage data file is unsafe.");
    if (path !== `${item.dataPath}${sidecarSuffix}`) throw new Error("Local storage metadata does not match its data path.");
    if (!item.trashed && this.folderIdForPath(dirname(item.dataPath)) !== item.parentIds[0]) throw new Error("Local storage metadata parent does not match its directory.");
    return item;
  }

  private async requireMetadata(fileId: string): Promise<LocalMetadata> {
    if (!validName(fileId)) throw new Error("File ID must be a safe name.");
    const found = (await this.metadataUnder(this.rootPath)).filter((item) => item.id === fileId);
    if (found.length !== 1) throw new Error("File was not found in local storage.");
    if (found[0].trashed) throw new Error("Local storage file is trashed and recoverable, not readable.");
    await stat(found[0].dataPath);
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

  private async assertAbsent(path: string): Promise<void> {
    try { await lstat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Error("Local storage destination already exists; refusing to overwrite it.");
  }

  private folderIdForPath(path: string): string | undefined {
    return [...this.folderPaths.entries()].find(([, relativePath]) => resolve(this.rootPath, relativePath) === resolve(path))?.[0];
  }

  private async publish(metadata: LocalMetadata, destination: string, update: Pick<LocalMetadata, "parentIds" | "dataPath" | "trashed">): Promise<void> {
    const sourceData = metadata.dataPath;
    const sourceMeta = `${sourceData}${sidecarSuffix}`;
    const destinationMeta = `${destination}${sidecarSuffix}`;
    const next: LocalMetadata = { ...metadata, parentIds: [...update.parentIds], dataPath: update.dataPath, trashed: update.trashed, appProperties: { ...metadata.appProperties } };
    const operationsRoot = resolve(this.rootPath, ".operations");
    await this.ensureSafeDirectory(operationsRoot);
    const operation = resolve(operationsRoot, randomUUID());
    await mkdir(operation, { mode: 0o700 });
    const stagedData = resolve(operation, "data");
    const stagedMeta = resolve(operation, "metadata.json");
    // Claim the exact source objects before publication. From this point on every
    // cleanup pathname is unpredictable and operation-owned; a new writer may
    // reuse the caller-visible source names without ever being unlinked by us.
    await rename(sourceData, stagedData);
    try { await rename(sourceMeta, stagedMeta); }
    catch (error) { await rename(stagedData, sourceData).catch(() => undefined); await rm(operation, { recursive: true, force: true }); throw error; }
    try {
      this.fault?.("beforeDataPublish");
      try {
        await link(stagedData, destination); // atomic EEXIST refusal: never replaces a destination.
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== "EEXIST") throw linkError;
        // A prior interrupted attempt leaves only our hardlink and no commit
        // marker. Resume that exact inode; contested names are never removed.
        const [sourceInfo, destinationInfo, destinationSidecar] = await Promise.all([
          lstat(stagedData), lstat(destination), lstat(destinationMeta).catch((error) => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error)),
        ]);
        if (destinationSidecar || sourceInfo.dev !== destinationInfo.dev || sourceInfo.ino !== destinationInfo.ino) throw linkError;
      }
      this.fault?.("afterDataPublish");
      this.fault?.("beforeMetadataPublish");
      this.fault?.("afterSourceMetadataRemove");
      this.fault?.("afterSourceDataRemove");
      this.fault?.("afterMetadataPublish");
      const [foreignData, foreignMeta] = await Promise.all([
        lstat(sourceData).then(() => true, (error) => (error as NodeJS.ErrnoException).code === "ENOENT" ? false : Promise.reject(error)),
        lstat(sourceMeta).then(() => true, (error) => (error as NodeJS.ErrnoException).code === "ENOENT" ? false : Promise.reject(error)),
      ]);
      if (foreignData || foreignMeta) throw new Error(`Foreign source replacement detected; original bytes retained in quarantine ${operation}`);
      await writeFile(destinationMeta, JSON.stringify(next), { flag: "wx", mode: 0o600 });
      await rm(operation, { recursive: true, force: true });
    } catch (error) {
      const [sourceDataExists, sourceMetaExists] = await Promise.all([
        lstat(sourceData).then(() => true, () => false), lstat(sourceMeta).then(() => true, () => false),
      ]);
      if (!sourceDataExists && !sourceMetaExists) {
        const rollback: unknown[] = [];
        try { await rename(stagedData, sourceData); } catch (cause) { rollback.push(cause); }
        try { await rename(stagedMeta, sourceMeta); } catch (cause) { rollback.push(cause); }
        if (rollback.length === 0) await rm(operation, { recursive: true, force: true });
        else throw new AggregateError([error, ...rollback], `Local storage integrity rollback failed; original bytes retained in quarantine ${operation}`);
      } else {
        throw new AggregateError([error], `Foreign source replacement detected; original bytes retained in quarantine ${operation}`);
      }
      throw error;
    }
  }
}
