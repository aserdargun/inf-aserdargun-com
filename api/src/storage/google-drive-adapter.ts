import { google } from "googleapis";
import type { CreateFileInput, StoragePort, StoredFile } from "./storage-port.js";

const folderMimeType = "application/vnd.google-apps.folder";
const metadataFields = "id,name,mimeType,createdTime,parents,appProperties,trashed";
const listFields = `nextPageToken,files(${metadataFields})`;
const retryableStatuses = new Set([429, 500, 502, 503, 504]);

interface DriveClient {
  files: {
    get(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ data: unknown }>;
    list(params: Record<string, unknown>): Promise<{ data: unknown }>;
    create(params: Record<string, unknown>): Promise<{ data: unknown }>;
    update(params: Record<string, unknown>): Promise<{ data: unknown }>;
  };
}

interface DriveMetadata {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  createdTime?: string | null;
  parents?: string[] | null;
  appProperties?: Record<string, string | null> | null;
  trashed?: boolean | null;
}

export interface GoogleOAuthRefreshCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleDriveAdapterOptions {
  publicRootId: string;
  privateRootId: string;
  credentials?: GoogleOAuthRefreshCredentials;
  /** Structural injection exists solely for deterministic adapter tests. */
  client?: DriveClient;
  sleep?: (milliseconds: number) => Promise<void>;
  jitter?: (baseMilliseconds: number) => number;
}

export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function asErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  return typeof candidate.code === "number" ? candidate.code : typeof candidate.response?.status === "number" ? candidate.response.status : undefined;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Drive response is missing ${field}.`);
  return value;
}

function copied(file: StoredFile): StoredFile {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    createdTime: file.createdTime,
    parentIds: [...file.parentIds],
    appProperties: { ...file.appProperties },
  };
}

export class GoogleDriveAdapter implements StoragePort {
  private readonly client: DriveClient;
  private readonly roots: Set<string>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly jitter: (baseMilliseconds: number) => number;

  constructor(private readonly options: GoogleDriveAdapterOptions) {
    if (!options.publicRootId || !options.privateRootId || options.publicRootId === options.privateRootId) {
      throw new Error("Distinct configured public and private Drive roots are required.");
    }
    this.roots = new Set([options.publicRootId, options.privateRootId]);
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.jitter = options.jitter ?? (() => 0);
    this.client = options.client ?? this.realClient(options.credentials);
  }

  async listChildren(folderId: string): Promise<StoredFile[]> {
    await this.requireFolder(folderId);
    return (await this.listDirect(folderId)).map(copied);
  }

  async readFile(fileId: string): Promise<Buffer> {
    const metadata = await this.requireFile(fileId);
    if (metadata.mimeType === folderMimeType) throw new Error("Drive target must be a file, not a folder.");
    const response = await this.retry(() => this.client.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" }));
    const data = response.data;
    if (Buffer.isBuffer(data)) return Buffer.from(data);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    throw new Error("Drive media response was not binary.");
  }

  async createFile(input: CreateFileInput): Promise<StoredFile> {
    await this.requireFolder(input.parentId);
    if (!input.name || input.name.length > 240 || !input.mimeType || !Buffer.isBuffer(input.bytes)) throw new Error("Invalid Drive file input.");
    const properties = { ...(input.appProperties ?? {}) };
    for (const [key, value] of Object.entries(properties)) this.validateProperty(key, value);
    const response = await this.retry(() => this.client.files.create({
      requestBody: { name: input.name, mimeType: input.mimeType, parents: [input.parentId], appProperties: properties },
      media: { mimeType: input.mimeType, body: Buffer.from(input.bytes) },
      fields: metadataFields,
    }));
    return copied(this.requireDirectChild(response.data, input.parentId));
  }

  async moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    const current = await this.requireFile(fileId);
    if (current.parentIds.length !== 1 || current.parentIds[0] !== fromFolderId) throw new Error("Drive file does not have the requested current parent.");
    await this.requireFolder(fromFolderId);
    await this.requireFolder(toFolderId);
    const response = await this.retry(() => this.client.files.update({
      fileId, addParents: toFolderId, removeParents: fromFolderId, fields: metadataFields,
    }));
    this.requireDirectChild(response.data, toFolderId);
  }

  async trashFile(fileId: string): Promise<void> {
    await this.requireFile(fileId);
    await this.retry(() => this.client.files.update({ fileId, requestBody: { trashed: true }, fields: metadataFields }));
  }

  async findByAppProperty(rootId: string, key: string, value: string): Promise<StoredFile[]> {
    this.validateProperty(key, value);
    await this.requireFolder(rootId);
    const matches: StoredFile[] = [];
    const queued = [rootId];
    const visited = new Set<string>();
    while (queued.length > 0) {
      const parentId = queued.shift()!;
      if (visited.has(parentId)) throw new Error("Drive folder ancestry contains a cycle.");
      visited.add(parentId);
      for (const child of await this.listDirect(parentId)) {
        if (child.appProperties[key] === value) matches.push(copied(child));
        if (child.mimeType === folderMimeType) queued.push(child.id);
      }
    }
    return matches;
  }

  async isDescendant(fileId: string, rootId: string): Promise<boolean> {
    await this.requireFolder(rootId);
    if (fileId === rootId) return true;
    const visited = new Set<string>();
    let current = fileId;
    while (current !== rootId) {
      if (visited.has(current)) throw new Error("Drive file ancestry contains a cycle.");
      visited.add(current);
      if (this.roots.has(current)) return false;
      const metadata = await this.metadata(current);
      if (metadata.parentIds.length !== 1) throw new Error("Drive file ancestry is missing or ambiguous.");
      current = metadata.parentIds[0];
    }
    return true;
  }

  private realClient(credentials: GoogleOAuthRefreshCredentials | undefined): DriveClient {
    if (!credentials?.clientId || !credentials.clientSecret || !credentials.refreshToken) {
      throw new Error("Google OAuth refresh credentials are required when no Drive client is injected.");
    }
    const auth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
    auth.setCredentials({ refresh_token: credentials.refreshToken });
    return google.drive({ version: "v3", auth }) as unknown as DriveClient;
  }

  private async requireFolder(folderId: string): Promise<StoredFile> {
    const metadata = await this.requireAllowed(fileIdOrFolderId(folderId));
    if (metadata.mimeType !== folderMimeType) throw new Error("Drive target must be a folder.");
    return metadata;
  }

  private async requireFile(fileId: string): Promise<StoredFile> {
    return this.requireAllowed(fileIdOrFolderId(fileId));
  }

  private async requireAllowed(fileId: string): Promise<StoredFile> {
    if (this.roots.has(fileId)) return this.metadata(fileId, true);
    const visited = new Set<string>();
    let current = fileId;
    let first: StoredFile | undefined;
    while (!this.roots.has(current)) {
      if (visited.has(current)) throw new Error("Drive file ancestry contains a cycle.");
      visited.add(current);
      const metadata = await this.metadata(current);
      first ??= metadata;
      if (metadata.parentIds.length !== 1) throw new Error("Drive file ancestry is missing or ambiguous.");
      current = metadata.parentIds[0];
    }
    return first ?? this.metadata(fileId, true);
  }

  private async metadata(fileId: string, root = false): Promise<StoredFile> {
    const response = await this.retry(() => this.client.files.get({ fileId, fields: metadataFields }));
    const file = this.toStored(response.data);
    if (root && !this.roots.has(file.id)) throw new Error("Drive root is not configured.");
    return file;
  }

  private async listDirect(parentId: string): Promise<StoredFile[]> {
    const files: StoredFile[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.retry(() => this.client.files.list({
        q: `'${escapeDriveQueryLiteral(parentId)}' in parents and trashed = false`,
        fields: listFields, pageToken, pageSize: 1000, spaces: "drive",
      }));
      const data = response.data as { files?: unknown[]; nextPageToken?: unknown };
      if (!data || typeof data !== "object" || !Array.isArray(data.files)) throw new Error("Drive list response is malformed.");
      for (const raw of data.files) files.push(this.requireDirectChild(raw, parentId));
      pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : undefined;
    } while (pageToken !== undefined);
    return files;
  }

  private requireDirectChild(raw: unknown, parentId: string): StoredFile {
    const file = this.toStored(raw);
    if (file.parentIds.length !== 1 || file.parentIds[0] !== parentId || this.roots.has(file.id) || !file.id) {
      throw new Error("Drive response has missing or ambiguous parent data.");
    }
    return file;
  }

  private toStored(raw: unknown): StoredFile {
    if (!raw || typeof raw !== "object") throw new Error("Drive response is malformed.");
    const source = raw as DriveMetadata;
    const parents = source.parents ?? [];
    if (!Array.isArray(parents) || !parents.every((item) => typeof item === "string" && item.length > 0)) throw new Error("Drive response has invalid parents.");
    const appProperties: Record<string, string> = {};
    if (source.appProperties !== null && source.appProperties !== undefined) {
      for (const [key, value] of Object.entries(source.appProperties)) if (typeof value === "string") appProperties[key] = value;
    }
    return { id: assertString(source.id, "id"), name: assertString(source.name, "name"), mimeType: assertString(source.mimeType, "mimeType"), createdTime: assertString(source.createdTime, "createdTime"), parentIds: parents, appProperties };
  }

  private validateProperty(key: string, value: string): void {
    if (!key || !value || key.length > 128 || value.length > 512) throw new Error("Drive app property key and value must be bounded non-empty strings.");
    // Keep escaping adjacent to validation so a future query optimization cannot reintroduce literal injection.
    escapeDriveQueryLiteral(key); escapeDriveQueryLiteral(value);
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    const delays = [250, 500, 1000];
    for (let attempt = 0; ; attempt += 1) {
      try { return await operation(); } catch (error) {
        if (attempt >= delays.length || !retryableStatuses.has(asErrorStatus(error) ?? -1)) throw error;
        await this.sleep(delays[attempt] + this.jitter(delays[attempt]));
      }
    }
  }
}

function fileIdOrFolderId(value: string): string {
  if (!value || value.length > 512) throw new Error("Drive file or folder ID is invalid.");
  return value;
}
