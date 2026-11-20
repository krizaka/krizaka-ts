import { describe, expect, it } from "vitest";

import { createDocuments, DOCUMENT_CODE, DocumentError, memoryDocumentStore } from "../src";

function setup() {
  let n = 0;
  let minute = 0;
  const docs = createDocuments({
    store: memoryDocumentStore(),
    clock: { now: () => new Date(Date.UTC(2026, 0, 1, 0, minute++)) },
    newId: () => `id-${++n}`,
  });
  return docs;
}
const code = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return error instanceof DocumentError ? error.code : null;
};

describe("documents", () => {
  it("creates nested folders and lists them by parent", async () => {
    const docs = setup();
    const root = await docs.createFolder("t1", { name: " Contracts ", parentId: null });
    const child = await docs.createFolder("t1", { name: "2026", parentId: root.id });
    expect(root.name).toBe("Contracts");
    expect(await docs.listFolders("t1", null)).toEqual([root]);
    expect(await docs.listFolders("t1", root.id)).toEqual([child]);
  });

  it("creates a document at version 1 and adds versions without touching the old ones", async () => {
    const docs = setup();
    const folder = await docs.createFolder("t1", { name: "A", parentId: null });
    const doc = await docs.createDocument("t1", {
      folderId: folder.id,
      name: "Lease",
      content: { ref: "b1", size: 10 },
    });
    const first = doc.versions[0];
    const next = await docs.addVersion("t1", doc.id, { ref: "b2", size: 12 });
    expect(next.versions.map((v) => [v.number, v.ref])).toEqual([
      [1, "b1"],
      [2, "b2"],
    ]);
    expect(next.versions[0]).toEqual(first);
    expect(await docs.listDocuments("t1", folder.id)).toEqual([next]);
  });

  it("refuses bad names and bad content with typed codes", async () => {
    const docs = setup();
    const folder = await docs.createFolder("t1", { name: "A", parentId: null });
    expect(await code(docs.createFolder("t1", { name: "  ", parentId: null }))).toBe(DOCUMENT_CODE.InvalidName);
    expect(await code(docs.createFolder("t1", { name: "x".repeat(256), parentId: null }))).toBe(
      DOCUMENT_CODE.InvalidName,
    );
    const doc = { folderId: folder.id, name: "D", content: { ref: "", size: 1 } };
    expect(await code(docs.createDocument("t1", doc))).toBe(DOCUMENT_CODE.InvalidContent);
    expect(await code(docs.createDocument("t1", { ...doc, content: { ref: "b", size: -1 } }))).toBe(
      DOCUMENT_CODE.InvalidContent,
    );
  });

  it("never shows one tenant's folders or documents to another", async () => {
    const docs = setup();
    const folder = await docs.createFolder("t1", { name: "A", parentId: null });
    const doc = await docs.createDocument("t1", { folderId: folder.id, name: "D", content: { ref: "b", size: 1 } });
    expect(await code(docs.createFolder("t2", { name: "B", parentId: folder.id }))).toBe(DOCUMENT_CODE.FolderNotFound);
    expect(await code(docs.getDocument("t2", doc.id))).toBe(DOCUMENT_CODE.DocumentNotFound);
    expect(await code(docs.addVersion("t2", doc.id, { ref: "b", size: 1 }))).toBe(DOCUMENT_CODE.DocumentNotFound);
    expect(await docs.listFolders("t2", null)).toEqual([]);
  });
});
