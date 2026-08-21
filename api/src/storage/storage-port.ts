export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  parentIds: string[];
  appProperties: Record<string, string>;
}

export interface CreateFileInput {
  name: string;
  mimeType: string;
  parentId: string;
  bytes: Buffer;
  appProperties?: Record<string, string>;
  /** Used only by the local immutable-event simulation; remote Drive assigns IDs. */
  fileId?: string;
}

export interface StoragePort {
  listChildren(folderId: string): Promise<StoredFile[]>;
  readFile(fileId: string): Promise<Buffer>;
  createFile(input: CreateFileInput): Promise<StoredFile>;
  moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void>;
  trashFile(fileId: string): Promise<void>;
  findByAppProperty(rootId: string, key: string, value: string): Promise<StoredFile[]>;
  isDescendant(fileId: string, rootId: string): Promise<boolean>;
}
