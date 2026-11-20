export interface Clock {
  now(): Date;
}

export interface Folder {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  createdAt: Date;
}

/** Where a version's bytes live (the storage vault's reference) and how large they are. */
export interface Content {
  ref: string;
  size: number;
}

/** One immutable version: a new upload makes a new one, it never rewrites an old one. */
export interface DocumentVersion extends Content {
  number: number;
  createdAt: Date;
}

export interface DocumentRecord {
  id: string;
  tenantId: string;
  folderId: string;
  name: string;
  versions: readonly DocumentVersion[];
}

/** The store of one deployment. Every read and write is scoped by tenant; an id of another tenant is « not found ». */
export interface DocumentStore {
  insertFolder(folder: Folder): Promise<void>;
  folder(tenantId: string, id: string): Promise<Folder | null>;
  folders(tenantId: string, parentId: string | null): Promise<Folder[]>;
  insertDocument(document: DocumentRecord): Promise<void>;
  document(tenantId: string, id: string): Promise<DocumentRecord | null>;
  documents(tenantId: string, folderId: string): Promise<DocumentRecord[]>;
  appendVersion(tenantId: string, id: string, version: DocumentVersion): Promise<void>;
}
