import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { CreateFileInput, StoragePort, StoredFile } from "./storage-port.js";

interface LocalMetadata extends StoredFile {
  trashed: boolean;
  dataPath: string;
}

export interface LocalDriveAdapterOptions {
  rootPath?: string;
  folderPaths: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
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

  constructor(options: LocalDriveAdapterOptions) {
    this.rootPath = resolve(options.rootPath ?? process.env.INF_LOCAL_STORAGE_ROOT ?? ".inf-local-storage");
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
    await mkdir(parentPath, { recursive: true, mode: 0o700 });
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
    const metadata = await this.requireMetadata(fileId);
    if (metadata.trashed || metadata.parentIds.length !== 1 || metadata.parentIds[0] !== fromFolderId) {
      throw new Error("File does not have the requested current parent.");
    }
    const fromPath = await this.folderPath(fromFolderId);
    const toPath = await this.folderPath(toFolderId);
    this.assertInside(fromPath, metadata.dataPath);
    await mkdir(toPath, { recursive: true, mode: 0o700 });
    const destination = resolve(toPath, `${fileId}.blob`);
    this.assertInside(toPath, destination);
    await this.assertAbsent(destination);
    await this.assertAbsent(`${destination}${sidecarSuffix}`);
    await rename(metadata.dataPath, destination);
    await rename(`${metadata.dataPath}${sidecarSuffix}`, `${destination}${sidecarSuffix}`);
    metadata.parentIds = [toFolderId];
    metadata.dataPath = destination;
    await writeFile(`${destination}${sidecarSuffix}`, JSON.stringify(metadata), { mode: 0o600 });
  }

  async trashFile(fileId: string): Promise<void> {
    const metadata = await this.requireMetadata(fileId);
    if (metadata.trashed) return;
    const trashPath = resolve(this.rootPath, ".trash");
    this.assertInside(this.rootPath, trashPath);
    await mkdir(trashPath, { recursive: true, mode: 0o700 });
    const destination = resolve(trashPath, `${fileId}.blob`);
    await this.assertAbsent(destination);
    await this.assertAbsent(`${destination}${sidecarSuffix}`);
    await rename(metadata.dataPath, destination);
    await rename(`${metadata.dataPath}${sidecarSuffix}`, `${destination}${sidecarSuffix}`);
    metadata.trashed = true;
    metadata.dataPath = destination;
    await writeFile(`${destination}${sidecarSuffix}`, JSON.stringify(metadata), { mode: 0o600 });
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
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    await this.assertNoSymlink(resolved);
    return resolved;
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

  private async assertNoSymlink(path: string): Promise<void> {
    const root = resolve(this.rootPath);
    this.assertInside(root, path);
    let current = root;
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const segment of relative(root, path).split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("Local storage configured folder contains a symlink.");
      if (!info.isDirectory()) throw new Error("Local storage configured folder is not a directory.");
    }
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
}
