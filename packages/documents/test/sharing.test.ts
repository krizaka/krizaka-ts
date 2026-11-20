import { describe, expect, it } from "vitest";

import { createDocuments, createSharing, DOCUMENT_CODE, DocumentError, memoryDocumentStore, memoryLinkStore } from "../src";

const DAY = 86_400_000;

async function setup() {
  let n = 0;
  let now = Date.UTC(2026, 0, 1);
  const clock = { now: () => new Date(now) };
  const documents = createDocuments({ store: memoryDocumentStore(), clock, newId: () => `id-${++n}` });
  const sharing = createSharing({
    links: memoryLinkStore(),
    documents,
    clock,
    limits: { defaultExpiryDays: 7, maxExpiryDays: 30, maxOpensCeiling: 100 },
    newId: () => `link-${++n}`,
    newToken: () => `tok-${++n}`,
    hashToken: (t) => `h(${t})`,
  });
  const folder = await documents.createFolder("t1", { name: "F", parentId: null });
  const doc = await documents.createDocument("t1", { folderId: folder.id, name: "a.pdf", content: { ref: "r", size: 1 } });
  return { sharing, doc, advance: (ms: number) => (now += ms) };
}
const code = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  return e instanceof DocumentError ? e.code : null;
};

describe("share links", () => {
  it("opens, then is refused after revoke", async () => {
    const { sharing, doc } = await setup();
    const { link, token } = await sharing.createLink("t1", { documentId: doc.id, access: "view" });
    expect(link.tokenHash).not.toBe(token);
    expect(await sharing.openLink(token)).toEqual({ tenantId: "t1", documentId: doc.id, access: "view" });
    await sharing.revokeLink("t1", link.id);
    expect(await code(sharing.openLink(token))).toBe(DOCUMENT_CODE.LinkRefused);
  });
  it("always expires: default 7 days, refused after, and above the maximum is invalid", async () => {
    const { sharing, doc, advance } = await setup();
    const { link, token } = await sharing.createLink("t1", { documentId: doc.id, access: "download" });
    expect(link.expiresAt.getTime() - link.createdAt.getTime()).toBe(7 * DAY);
    advance(7 * DAY);
    expect(await code(sharing.openLink(token))).toBe(DOCUMENT_CODE.LinkRefused);
    expect(await code(sharing.createLink("t1", { documentId: doc.id, access: "view", expiresInDays: 31 }))).toBe(DOCUMENT_CODE.InvalidLink);
  });
  it("caps the opens", async () => {
    const { sharing, doc } = await setup();
    const { token } = await sharing.createLink("t1", { documentId: doc.id, access: "view", maxOpens: 2 });
    await sharing.openLink(token);
    await sharing.openLink(token);
    expect(await code(sharing.openLink(token))).toBe(DOCUMENT_CODE.LinkRefused);
    expect(await code(sharing.createLink("t1", { documentId: doc.id, access: "view", maxOpens: 101 }))).toBe(DOCUMENT_CODE.InvalidLink);
  });
  it("refuses a document of another tenant and an unknown token", async () => {
    const { sharing, doc } = await setup();
    expect(await code(sharing.createLink("t2", { documentId: doc.id, access: "view" }))).toBe(DOCUMENT_CODE.DocumentNotFound);
    expect(await code(sharing.openLink("nope"))).toBe(DOCUMENT_CODE.LinkRefused);
    expect(await code(sharing.revokeLink("t2", "link-x"))).toBe(DOCUMENT_CODE.LinkRefused);
  });
});
