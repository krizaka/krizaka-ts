# @krizaka/documents

Folders, documents and immutable versions for a Krizaka product, behind a port. This first slice holds the model, the typed errors
(`DocumentError`, `DOCUMENT_CODE`) and a memory store; the PostgreSQL adapter, encrypted names, the change feed, trash, upload and
privacy contributors follow (krizaka-internal#1932).

```ts
const docs = createDocuments({ store: memoryDocumentStore(), clock, newId });
const folder = await docs.createFolder(tenant, { name: "Contracts", parentId: null });
const doc = await docs.createDocument(tenant, {
  folderId: folder.id,
  name: "Lease",
  content: { ref: "blob-1", size: 10 },
});
await docs.addVersion(tenant, doc.id, { ref: "blob-2", size: 12 }); // version 2; version 1 is never changed
```
