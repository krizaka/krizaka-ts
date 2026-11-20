import type { DocumentRecord, DocumentStore, Folder } from "./port";

/** The store in memory: for tests and demos; the PostgreSQL adapter must pass the same behaviour. */
export function memoryDocumentStore(): DocumentStore {
  const folders = new Map<string, Folder>();
  const documents = new Map<string, DocumentRecord>();
  const own = <T extends { tenantId: string }>(item: T | undefined, tenantId: string) =>
    item && item.tenantId === tenantId ? item : null;
  return {
    async insertFolder(folder) {
      folders.set(folder.id, folder);
    },
    async folder(tenantId, id) {
      return own(folders.get(id), tenantId);
    },
    async folders(tenantId, parentId) {
      return [...folders.values()].filter((f) => f.tenantId === tenantId && f.parentId === parentId);
    },
    async insertDocument(document) {
      documents.set(document.id, document);
    },
    async document(tenantId, id) {
      return own(documents.get(id), tenantId);
    },
    async documents(tenantId, folderId) {
      return [...documents.values()].filter((d) => d.tenantId === tenantId && d.folderId === folderId);
    },
    async appendVersion(tenantId, id, version) {
      const current = own(documents.get(id), tenantId);
      if (current) documents.set(id, { ...current, versions: [...current.versions, version] });
    },
  };
}
