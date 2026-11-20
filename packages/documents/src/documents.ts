import { DOCUMENT_CODE, DocumentError } from "./errors";
import type { Clock, Content, DocumentRecord, DocumentStore, Folder } from "./port";

export interface DocumentsDeps {
  store: DocumentStore;
  clock: Clock;
  /** A new unique id (the product's id generator). */
  newId: () => string;
}

const NAME_MAX = 255;

function checkName(name: string): string {
  const clean = name.trim();
  if (clean === "" || clean.length > NAME_MAX)
    throw new DocumentError(DOCUMENT_CODE.InvalidName, `a name is 1 to ${NAME_MAX} characters`);
  return clean;
}

function checkContent(content: Content): Content {
  if (content.ref === "" || !Number.isSafeInteger(content.size) || content.size < 0)
    throw new DocumentError(DOCUMENT_CODE.InvalidContent, "content needs a reference and a size of 0 or more");
  return { ref: content.ref, size: content.size };
}

/**
 * Folders, documents and immutable versions of a product.
 * @param deps the store, the clock and the id generator
 * @returns the functions, each scoped by tenant
 */
export function createDocuments(deps: DocumentsDeps) {
  const { store, clock, newId } = deps;
  const requireFolder = async (tenantId: string, id: string) => {
    const folder = await store.folder(tenantId, id);
    if (!folder) throw new DocumentError(DOCUMENT_CODE.FolderNotFound, "folder not found");
    return folder;
  };
  const requireDocument = async (tenantId: string, id: string) => {
    const document = await store.document(tenantId, id);
    if (!document) throw new DocumentError(DOCUMENT_CODE.DocumentNotFound, "document not found");
    return document;
  };
  return {
    async createFolder(tenantId: string, input: { name: string; parentId: string | null }): Promise<Folder> {
      const name = checkName(input.name);
      if (input.parentId !== null) await requireFolder(tenantId, input.parentId);
      const folder: Folder = { id: newId(), tenantId, parentId: input.parentId, name, createdAt: clock.now() };
      await store.insertFolder(folder);
      return folder;
    },
    listFolders: (tenantId: string, parentId: string | null) => store.folders(tenantId, parentId),
    /** Creates a document with its version 1. */
    async createDocument(
      tenantId: string,
      input: { folderId: string; name: string; content: Content },
    ): Promise<DocumentRecord> {
      const name = checkName(input.name);
      const content = checkContent(input.content);
      await requireFolder(tenantId, input.folderId);
      const document: DocumentRecord = {
        id: newId(),
        tenantId,
        folderId: input.folderId,
        name,
        versions: [{ ...content, number: 1, createdAt: clock.now() }],
      };
      await store.insertDocument(document);
      return document;
    },
    listDocuments: (tenantId: string, folderId: string) => store.documents(tenantId, folderId),
    getDocument: (tenantId: string, id: string) => requireDocument(tenantId, id),
    /** Adds the next version; earlier versions are never changed. */
    async addVersion(tenantId: string, id: string, content: Content): Promise<DocumentRecord> {
      const checked = checkContent(content);
      const document = await requireDocument(tenantId, id);
      const number = document.versions.length + 1;
      await store.appendVersion(tenantId, id, { ...checked, number, createdAt: clock.now() });
      return requireDocument(tenantId, id);
    },
  };
}

export type Documents = ReturnType<typeof createDocuments>;
