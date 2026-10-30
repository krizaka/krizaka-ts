import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type FetchLike, memoryObjectStore, type ObjectStore } from "../src/node";
import {
  type AuditNote,
  createProviderService,
  memoryProviderStore,
  moveBatch,
  type ObjectCatalog,
  readDual,
  sha256Hex,
} from "../src/provider-admin";
import { providerStoreContract } from "../src/testkit";

providerStoreContract("memory", () => memoryProviderStore());

/** A tiny S3: PUT/GET/DELETE and ListObjectsV2 on path-style URLs, enough for the connection test and the sweep. */
function fakeS3(failPut = false) {
  const files = new Map<string, Uint8Array>();
  const call: FetchLike = async (url, init) => {
    const u = new URL(url);
    const respond = (status: number, body = "", bytes?: Uint8Array) => ({
      ok: status < 300,
      status,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array(bytes ?? new TextEncoder().encode(body)).buffer as ArrayBuffer,
      text: async () => body,
    });
    if (init.method === "PUT") {
      if (failPut) return respond(403);
      files.set(u.pathname, new Uint8Array(init.body ?? []));
      return respond(200);
    }
    if (init.method === "DELETE") {
      files.delete(u.pathname);
      return respond(204);
    }
    if (u.searchParams.get("list-type")) {
      const prefix = `${u.pathname}/${u.searchParams.get("prefix") ?? ""}`;
      const keys = [...files].filter(([p]) => p.startsWith(prefix));
      return respond(
        200,
        `<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map(([p, b]) => `<Contents><Key>${p.slice(u.pathname.length + 1)}</Key><Size>${b.length}</Size></Contents>`).join("")}</ListBucketResult>`,
      );
    }
    const found = files.get(u.pathname);
    return found ? respond(200, "", found) : respond(404);
  };
  return { call, files };
}

const kek = randomBytes(32);
const coords = { endpoint: "https://tor1.digitaloceanspaces.com", region: "tor1", bucket: "docs" };
const creds = { accessKeyId: "AKIA-SECRET-ID", secretAccessKey: "super-secret-value" };
const admin = { id: "a1", label: "Eric" };
const at = { now: () => new Date("2026-10-28T12:00:00Z") };

function setup(over: { failPut?: boolean; references?: (id: string) => Promise<number> } = {}) {
  const s3 = fakeS3(over.failPut);
  const notes: AuditNote[] = [];
  let n = 0;
  const store = memoryProviderStore();
  const service = createProviderService({
    store,
    vault: { keyId: "k1", key: kek, ring: { keys: { k1: kek } } },
    clock: at,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    audit: async (note) => void notes.push(note),
    open: { runtime: "dev", environment: "dev", fetch: s3.call, clock: at },
    probeId: () => "probe",
    references: over.references ?? (async () => 0),
  });
  return { service, notes, store, s3 };
}

const spaces = (label: string, extra: Record<string, string> = {}) => ({
  scope: "org",
  kind: "s3",
  label,
  coordinates: coords,
  credentials: { ...creds, ...extra },
});

describe("provider service", () => {
  it("creates a draft and never returns a secret, only set / not set", async () => {
    const { service, notes } = setup();
    const created = await service.create(admin, spaces("Spaces"));
    expect(created.status).toBe("draft");
    expect(created.credentials).toEqual({ accessKeyId: "set", secretAccessKey: "set", encryptionKey: "not set" });
    const everything = JSON.stringify([created, await service.list("org"), notes]);
    expect(everything).not.toContain("super-secret-value");
    expect(everything).not.toContain("AKIA-SECRET-ID");
    expect(notes[0]).toMatchObject({
      action: "storage.provider_created",
      detail: { credentials: { accessKeyId: "changed", secretAccessKey: "changed" } },
    });
  });

  it("refuses unknown fields, and a user scope for a kind that is admin-only", async () => {
    const { service } = setup();
    await expect(
      service.create(admin, { ...spaces("x"), coordinates: { ...coords, bogus: "1" } }),
    ).rejects.toMatchObject({ code: "STORAGE_BAD_CONFIG" });
    await expect(
      service.create(admin, { scope: "user:u1", kind: "bunny", label: "x", coordinates: {}, credentials: {} }),
    ).rejects.toMatchObject({ code: "STORAGE_BAD_CONFIG" });
  });

  it("only a green test verifies; only a verified provider becomes a default", async () => {
    const { service } = setup();
    const p = await service.create(admin, spaces("Spaces"));
    await expect(service.setDefault(admin, p.id, "org", "documents")).rejects.toMatchObject({
      code: "STORAGE_PROVIDER_NOT_VERIFIED",
    });
    const tested = await service.test(admin, p.id);
    expect(tested.status).toBe("verified");
    expect(tested.lastTest).toMatchObject({ ok: true, residency: { key: "canada-on" } });
    expect((await service.setDefault(admin, p.id, "org", "documents")).status).toBe("active");
  });

  it("a failing test leaves the provider a draft, without a secret in the trail", async () => {
    const { service, notes } = setup({ failPut: true });
    const p = await service.create(admin, spaces("Spaces"));
    const tested = await service.test(admin, p.id);
    expect(tested.status).toBe("draft");
    expect(tested.lastTest?.ok).toBe(false);
    expect(JSON.stringify(notes)).not.toContain("super-secret-value");
  });

  it("a new default puts the old one to `retiring`; it cannot be disabled or retired while objects reach it", async () => {
    let held = 3;
    const { service } = setup({ references: async () => held });
    const a = await service.create(admin, spaces("A"));
    const b = await service.create(admin, { ...spaces("B"), coordinates: { ...coords, bucket: "other" } });
    for (const p of [a, b]) await service.test(admin, p.id);
    await service.setDefault(admin, a.id, "org", "documents");
    await service.setDefault(admin, b.id, "org", "documents");
    expect((await service.list("org")).map((p) => p.status)).toEqual(["retiring", "active"]);
    await expect(service.disable(admin, a.id)).rejects.toMatchObject({ code: "STORAGE_PROVIDER_IN_USE" });
    await expect(service.disable(admin, b.id)).rejects.toMatchObject({ code: "STORAGE_PROVIDER_IN_USE" });
    await expect(service.retire(admin, a.id)).rejects.toMatchObject({ code: "STORAGE_PROVIDER_IN_USE" });
    held = 0;
    expect((await service.retire(admin, a.id)).provider.status).toBe("disabled");
  });

  it("changing a key tests the candidate first and saves nothing when it fails", async () => {
    const { service, store } = setup();
    const p = await service.create(admin, spaces("A"));
    const before = (await store.get(p.id))!.sealedCredentials;
    const ok = await service.changeKey(admin, p.id, { secretAccessKey: "new-secret" });
    expect(ok.credentials.secretAccessKey).toBe("set");
    expect((await store.get(p.id))!.sealedCredentials).not.toBe(before);

    const bad = setup({ failPut: true });
    const q = await bad.service.create(admin, spaces("A"));
    const sealed = (await bad.store.get(q.id))!.sealedCredentials;
    await expect(bad.service.changeKey(admin, q.id, { secretAccessKey: "x" })).rejects.toMatchObject({
      code: "STORAGE_TEST_FAILED",
    });
    expect((await bad.store.get(q.id))!.sealedCredentials).toBe(sealed);
  });

  it("seals the object-encryption key with the provider: the bucket holds ciphertext", async () => {
    const { service, s3 } = setup();
    const p = await service.create(admin, spaces("A", { encryptionKey: randomBytes(32).toString("base64") }));
    await service.test(admin, p.id);
    await service.setDefault(admin, p.id, "org", "documents");
    const opened = (await service.openDefault("org", "documents"))!;
    await opened.store.put("docs/a.pdf", new TextEncoder().encode("PLAIN-CONTENT"), { contentType: "application/pdf" });
    expect([...s3.files.values()].some((b) => new TextDecoder().decode(b).includes("PLAIN-CONTENT"))).toBe(false);
    expect(new TextDecoder().decode((await opened.store.get("docs/a.pdf"))!.bytes)).toBe("PLAIN-CONTENT");
  });

  it("bootstraps from the environment once, active and audited; then the environment chooses nothing", async () => {
    const { service, notes } = setup();
    const env = {
      kind: "s3",
      coordinates: coords,
      credentials: creds,
      label: "From environment",
      dataKinds: ["documents"],
    };
    const first = await service.bootstrap(env);
    expect(first).toMatchObject({ status: "active", source: "env" });
    expect(notes.at(-1)).toMatchObject({ action: "storage.provider_imported", actor: { label: "system" } });
    expect(await service.bootstrap(env)).toBeNull();
    expect(await service.bootstrap(null)).toBeNull();
    expect((await service.openDefault("org", "documents"))?.id).toBe(first!.id);
    expect(await service.openDefault("org", "avatars")).toBeNull();
  });

  it("rotates the vault key by re-wrapping every provider under the new key", async () => {
    const { service, store } = setup();
    const p = await service.create(admin, spaces("A"));
    const k2 = randomBytes(32);
    const rotated = createProviderService({
      store,
      vault: { keyId: "k2", key: k2, ring: { keys: { k1: kek, k2 } } },
      clock: at,
      newId: () => "x",
      audit: async () => undefined,
      open: { runtime: "dev", environment: "dev", fetch: fakeS3().call, clock: at },
      probeId: () => "p",
      references: async () => 0,
    });
    expect(await rotated.rotateVaultKey(admin)).toBe(1);
    expect((await store.get(p.id))!.keyId).toBe("k2");
    expect(await rotated.rotateVaultKey(admin)).toBe(0);
  });
});

describe("the move", () => {
  const body = (text: string) => new TextEncoder().encode(text);
  function world() {
    const oldStore = memoryObjectStore();
    const newStore = memoryObjectStore();
    const rows = new Map([
      ["o1", { key: "d/1.pdf", provider: "old", text: "one" }],
      ["o2", { key: "d/2.pdf", provider: "old", text: "two" }],
      ["o3", { key: "d/3.pdf", provider: "old", text: "three" }],
    ]);
    const catalog: ObjectCatalog = {
      pending: async (id, limit) =>
        [...rows]
          .filter(([, r]) => r.provider === id)
          .slice(0, limit)
          .map(([oid, r]) => ({
            id: oid,
            key: r.key,
            contentType: "application/pdf",
            sha256: sha256Hex(body(r.text)),
          })),
      remaining: async (id) => [...rows.values()].filter((r) => r.provider === id).length,
      switchProvider: async (oid, from, to) => {
        const row = rows.get(oid)!;
        if (row.provider !== from) return false;
        row.provider = to;
        return true;
      },
    };
    return {
      oldStore,
      newStore,
      rows,
      catalog,
      from: { id: "old", store: oldStore },
      to: { id: "new", store: newStore },
    };
  }

  it("copies, verifies the SHA-256 and switches, in bounded batches, resumable", async () => {
    const w = world();
    for (const r of w.rows.values()) await w.oldStore.put(r.key, body(r.text), { contentType: "application/pdf" });
    const first = await moveBatch({ catalog: w.catalog, from: w.from, to: w.to, limit: 2 });
    expect(first).toMatchObject({ copied: 2, verified: 2, switched: 2, failed: [], left: 1 });
    const second = await moveBatch({ catalog: w.catalog, from: w.from, to: w.to, limit: 2 });
    expect(second).toMatchObject({ switched: 1, left: 0 });
    expect((await w.newStore.get("d/3.pdf"))!.bytes).toEqual(body("three"));
  });

  it("never switches a row whose old copy is missing or altered, or whose new copy does not read back", async () => {
    const w = world();
    await w.oldStore.put("d/1.pdf", body("TAMPERED"), { contentType: "application/pdf" });
    await w.oldStore.put("d/3.pdf", body("three"), { contentType: "application/pdf" });
    const lying: ObjectStore = {
      ...w.newStore,
      get: async (k) => (k === "d/3.pdf" ? { bytes: body("other"), contentType: "x" } : w.newStore.get(k)),
    };
    const out = await moveBatch({ catalog: w.catalog, from: w.from, to: { id: "new", store: lying }, limit: 10 });
    expect(out.failed.map((f) => f.id)).toEqual(["o1", "o2", "o3"]);
    expect(out.switched).toBe(0);
    expect(out.left).toBe(3);
  });

  it("reads from the row's provider and falls back to the old one while the move runs", async () => {
    const w = world();
    await w.oldStore.put("d/1.pdf", body("one"), { contentType: "application/pdf" });
    const open = async (id: string) => (id === "old" ? w.oldStore : w.newStore);
    expect(await readDual({ key: "d/1.pdf", providerId: "new", fallbackIds: ["old"], open })).toMatchObject({
      providerId: "old",
    });
    expect(await readDual({ key: "d/9.pdf", providerId: "new", fallbackIds: ["old"], open })).toBeNull();
  });
});
