import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createProviderRegistry, defaultProviderRegistry, localKeyring, memoryObjectStore, type OpenContext, openEnvelope, openProvider, openWith, PROVIDER_KINDS, type ProviderKind, rewrapWith, sealEnvelope, sealWith, StorageError } from "../src/node";
import { type AuditNote, createProviderService, memoryProviderStore } from "../src/provider-admin";
import type { Keyring } from "../src/vault";

const clock = { now: () => new Date("2026-10-28T12:00:00Z") };
const ctx = (over: Partial<OpenContext> = {}): OpenContext => ({ runtime: "server", environment: "prod", fetch: (() => Promise.reject(new Error("no network"))) as OpenContext["fetch"], clock, ...over });
const code = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof StorageError ? e.code : `other:${String(e)}`;
  }
  return null;
};

const field = (name: string, type: "text" | "url" | "secret" = "text", required = true) => ({ name, type, required });
const privateKind = (over: Partial<ProviderKind> = {}): ProviderKind => ({
  kind: "acme-vault",
  scopes: ["admin"],
  runtimes: ["server", "dev"],
  devOnly: false,
  implemented: true,
  capabilities: { private: true, signedUrls: false, publicUrls: false, maxObjectBytes: 1024, serverSideEncryption: "provider" },
  residency: "fixed-elsewhere",
  coordinates: [field("endpoint", "url"), field("space")],
  credentials: [field("token", "secret")],
  ...over,
});
const acme = (seen: Array<Record<string, string | undefined>> = []) => ({
  kind: privateKind(),
  open: ({ coordinates }: { coordinates: Record<string, string | undefined> }) => {
    seen.push(coordinates);
    return { store: memoryObjectStore(), residency: { key: "elsewhere" as const, country: null, province: null, text: "Acme" } };
  },
});

describe("OpenDAL kinds in the registry", () => {
  it("google-drive and onedrive are implemented at user scope; azblob, gcs, b2 and webdav at admin scope", () => {
    const byName = (n: string) => PROVIDER_KINDS.find((k) => k.kind === n)!;
    for (const n of ["google-drive", "onedrive"]) expect(byName(n)).toMatchObject({ implemented: true, scopes: ["user"], residency: "user-cloud" });
    for (const n of ["azblob", "gcs", "b2", "webdav"]) expect(byName(n)).toMatchObject({ implemented: true, scopes: ["admin"] });
  });
  it("every implemented kind has an adapter, and a kind holds secrets only in credentials", () => {
    expect(() => createProviderRegistry({ kinds: PROVIDER_KINDS, adapters: {} })).toThrow(/no adapter/);
    for (const kind of PROVIDER_KINDS) expect(kind.coordinates.filter((f) => f.type === "secret")).toEqual([]);
  });
  it("opens a connected cloud lazily (nothing is called before the first operation) and says it is the person's cloud", async () => {
    const opened = await openProvider("google-drive", { clientId: "cid" }, { refreshToken: "RT" }, ctx());
    expect(opened.residency.key).toBe("user-cloud");
    expect(await code(() => openProvider("onedrive", {}, { refreshToken: "RT" }, ctx()))).toBe("STORAGE_BAD_CONFIG");
  });
  it("checks the typed endpoint of an OpenDAL kind before OpenDAL is called", async () => {
    const webdav = { endpoint: "https://10.0.0.5/dav" };
    expect(await code(() => openProvider("webdav", webdav, { username: "u", password: "p" }, ctx()))).toBe("STORAGE_BAD_ENDPOINT");
    expect(await code(() => openProvider("azblob", { endpoint: "http://blob.example.com", container: "c", account_name: "a" }, { account_key: "k" }, ctx()))).toBe("STORAGE_BAD_ENDPOINT");
    expect(await code(() => openProvider("b2", { bucket: "b" }, { application_key_id: "i", application_key: "k" }, ctx()))).toBe("STORAGE_BAD_CONFIG");
  });
});

describe("private provider plugins", () => {
  it("registers a kind without touching the core: the default registry is unchanged", async () => {
    const seen: Array<Record<string, string | undefined>> = [];
    const registry = defaultProviderRegistry.with(acme(seen));
    const opened = await openProvider("acme-vault", { endpoint: "https://vault.acme.example", space: "s1" }, { token: "t" }, ctx(), registry);
    expect(opened.kind.kind).toBe("acme-vault");
    expect(seen[0]?.endpoint).toBe("https://vault.acme.example");
    expect(defaultProviderRegistry.kind("acme-vault")).toBeUndefined();
    expect(registry.kinds.length).toBe(defaultProviderRegistry.kinds.length + 1);
    expect(await code(() => openProvider("acme-vault", {}, {}, ctx()))).toBe("STORAGE_BAD_CONFIG");
  });
  it("refuses a duplicate name, built-in or private", () => {
    expect(() => defaultProviderRegistry.with({ kind: privateKind({ kind: "s3" }), open: acme().open })).toThrow(/twice/);
    expect(() => defaultProviderRegistry.with(acme()).with(acme())).toThrow(/twice/);
  });
  it("applies the rules to private kinds: runtime, devOnly, required fields, url fields", async () => {
    const run = (kind: Partial<ProviderKind>, c: Record<string, string>, cx: Partial<OpenContext> = {}) => openProvider("acme-vault", c, { token: "t" }, ctx(cx), defaultProviderRegistry.with({ ...acme(), kind: privateKind(kind) }));
    const good = { endpoint: "https://vault.acme.example", space: "s1" };
    expect(await code(() => run({ runtimes: ["dev"] }, good))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => run({ devOnly: true }, good))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => run({}, { endpoint: "https://vault.acme.example" }))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => run({}, { ...good, endpoint: "https://192.168.1.4" }))).toBe("STORAGE_BAD_ENDPOINT");
    expect(await code(() => run({}, { ...good, endpoint: "http://vault.acme.example" }))).toBe("STORAGE_BAD_ENDPOINT");
    expect(await code(() => run({}, good))).toBeNull();
  });
  it("refuses a private kind whose secret would be shown or whose credential would not be sealed", () => {
    expect(() => defaultProviderRegistry.with({ ...acme(), kind: privateKind({ coordinates: [field("apiKey", "secret")] }) })).toThrow(/would be shown/);
    expect(() => defaultProviderRegistry.with({ ...acme(), kind: privateKind({ credentials: [field("token", "text")] }) })).toThrow(/sealed/);
    expect(() => defaultProviderRegistry.with({ ...acme(), kind: privateKind({ kind: "Bad Name" }) })).toThrow(/lowercase/);
  });
  it("runs through the service: scope, sealing and audit apply to the private kind", async () => {
    const kek = randomBytes(32);
    const notes: AuditNote[] = [];
    let n = 0;
    const service = createProviderService({
      store: memoryProviderStore(),
      vault: { keyId: "k1", key: kek, ring: { keys: { k1: kek } } },
      registry: defaultProviderRegistry.with(acme()),
      clock,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      audit: async (note) => void notes.push(note),
      open: ctx(),
      probeId: () => "probe",
      references: async () => 0,
    });
    const admin = { id: "a1", label: "Eric" };
    const made = await service.create(admin, { scope: "org", kind: "acme-vault", label: "Acme", coordinates: { endpoint: "https://vault.acme.example", space: "s1" }, credentials: { token: "TOP-SECRET" } });
    expect(JSON.stringify(made)).not.toContain("TOP-SECRET");
    expect(made.credentials).toMatchObject({ token: "set" });
    await expect(service.create(admin, { scope: "user:u1", kind: "acme-vault", label: "x", coordinates: {}, credentials: {} })).rejects.toMatchObject({ code: "STORAGE_BAD_CONFIG" });
    expect(JSON.stringify(notes)).not.toContain("TOP-SECRET");
    expect((await service.test(admin, made.id)).lastTest?.ok).toBe(true);
  });
});

/** A fake KMS: wraps with its own key, asynchronously, and counts calls. The app never sees that key. */
function fakeKms(keyId = "kms-1") {
  const key = randomBytes(32);
  const calls = { wrap: 0, unwrap: 0 };
  const ring: Keyring = {
    keyId,
    async wrap(dataKey, id) {
      calls.wrap += 1;
      return localKeyring({ keyId: id, key, ring: { keys: {} } }).wrap(dataKey, id) as string;
    },
    async unwrap(wrapped, id) {
      calls.unwrap += 1;
      if (id !== keyId) throw new StorageError("STORAGE_UNREADABLE", `No vault key ${id}`);
      return localKeyring({ keyId: id, key, ring: { keys: {} } }).unwrap(wrapped, id) as Uint8Array;
    },
  };
  return { ring, calls, key };
}

describe("the Keyring port", () => {
  it("the local keyring seals and opens the stored v2 format, the same as the sync functions", async () => {
    const kek = randomBytes(32);
    const ring = localKeyring({ keyId: "k1", key: kek, ring: { keys: {} } });
    expect(openEnvelope(await sealWith(ring, "s3cret"), { keys: { k1: kek } })).toBe("s3cret");
    expect(await openWith(ring, sealEnvelope("old-way", kek, "k1"))).toBe("old-way");
  });
  it("a v1 value opens only with a legacy key", async () => {
    const legacy = randomBytes(32);
    const { seal } = await import("../src/vault");
    const v1 = seal("legacy-secret", legacy);
    const without = localKeyring({ keyId: "k1", key: randomBytes(32), ring: { keys: {} } });
    expect(await code(() => openWith(without, v1))).toBe("STORAGE_UNREADABLE");
    const withLegacy = localKeyring({ keyId: "k1", key: randomBytes(32), ring: { keys: {}, legacy } });
    expect(await openWith(withLegacy, v1)).toBe("legacy-secret");
    expect(keyOf(await rewrapWith(withLegacy, v1))).toBe("k1");
  });
  it("a KMS-style asynchronous keyring seals, opens and rewraps without the app holding the key", async () => {
    const kms = fakeKms("kms-1");
    const sealed = await sealWith(kms.ring, "api-key");
    expect(sealed.startsWith("v2.kms-1.")).toBe(true);
    expect(sealed).not.toContain("api-key");
    expect(await openWith(kms.ring, sealed)).toBe("api-key");
    expect(kms.calls).toEqual({ wrap: 1, unwrap: 1 });
    // a move from the in-process key to the KMS is a re-wrap: the secret is never retyped
    const kek = randomBytes(32);
    const old = sealEnvelope("api-key", kek, "k1");
    const moved = await rewrapWith(kms.ring, old).catch((e: unknown) => e);
    expect(moved).toBeInstanceOf(StorageError); // the KMS cannot unwrap a key it does not hold: no silent fallback
    const viaLocal = await rewrapWith(localKeyring({ keyId: "kms-1", key: kms.key, ring: { keys: { k1: kek } } }), old);
    expect(await openWith(kms.ring, viaLocal)).toBe("api-key");
  });
  it("a tampered value and an unknown key id are unreadable", async () => {
    const kms = fakeKms();
    const sealed = await sealWith(kms.ring, "x");
    expect(await code(() => openWith(kms.ring, `${sealed.slice(0, -2)}AA`))).toBe("STORAGE_UNREADABLE");
    expect(await code(() => openWith(kms.ring, sealed.replace("v2.kms-1.", "v2.other.")))).toBe("STORAGE_UNREADABLE");
    expect(await code(() => openWith(kms.ring, "nonsense"))).toBe("STORAGE_UNREADABLE");
  });
  it("the service runs on a keyring and rotates the vault key through it", async () => {
    const kms = fakeKms("kms-1");
    const store = memoryProviderStore();
    const kek = randomBytes(32);
    let n = 0;
    const deps = (vault: Keyring) => ({ store, vault, clock, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, audit: async () => undefined, open: ctx(), probeId: () => "probe", references: async () => 0, registry: defaultProviderRegistry.with(acme()) });
    const before = createProviderService(deps(localKeyring({ keyId: "k1", key: kek, ring: { keys: {} } })));
    const admin = { id: "a1", label: "Eric" };
    const made = await before.create(admin, { scope: "org", kind: "acme-vault", label: "A", coordinates: { endpoint: "https://vault.acme.example", space: "s" }, credentials: { token: "T" } });
    const after = createProviderService(deps({ ...kms.ring, async unwrap(w, id) { return id === "k1" ? (localKeyring({ keyId: "k1", key: kek, ring: { keys: {} } }).unwrap(w, id) as Uint8Array) : kms.ring.unwrap(w, id); } }));
    expect(await after.rotateVaultKey(admin)).toBe(1);
    expect((await store.get(made.id))?.keyId).toBe("kms-1");
    expect((await after.list("org"))[0]?.credentials).toMatchObject({ token: "set" });
  });
});

const keyOf = (sealed: string) => sealed.split(".")[1];
