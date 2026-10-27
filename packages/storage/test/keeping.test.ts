import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { COUNTRY_OF_REGION, countryOf, describeStore, encryptedStore, memoryObjectStore, open, parseEncryptionKey, parseVaultKey, residencyOf, residencyOfConfig, seal, storageNotice, STORE_KIND, type StoreDescriptor, where } from "../src/node";
import { type DeploymentStorage, openResolved, resolveStorage } from "../src/resolve";
import { STORAGE_DEFAULTS, type StorageSettings } from "../src/settings";
import { objectStoreContract } from "../src/testkit";

const KEY = randomBytes(32);
const clock = { now: () => new Date("2026-10-27T12:00:00Z") };

describe("encryption at rest", () => {
  objectStoreContract("encryptedStore(memory)", () => encryptedStore(memoryObjectStore(), KEY));

  it("never hands the provider the plain bytes, and has no link a browser could open", async () => {
    const inner = memoryObjectStore({ publicBaseUrl: "https://cdn.example" });
    const store = encryptedStore(inner, KEY);
    await store.put("o/a/doc.txt", new TextEncoder().encode("Loyer mensuel : 1 450 $ — Sophie Gagnon"), { contentType: "text/plain" });
    const held = (await inner.get("o/a/doc.txt"))!;
    expect(Buffer.from(held.bytes).includes(Buffer.from("Sophie"))).toBe(false);
    expect(held.contentType).toBe("application/octet-stream");
    expect(store.publicUrl("o/a/doc.txt")).toBeNull();
    expect(await store.signedUrl("o/a/doc.txt", 60)).toBeNull();
  });

  it("refuses an object moved under another name, a tampered one, a wrong key and a non-envelope", async () => {
    const inner = memoryObjectStore();
    const store = encryptedStore(inner, KEY);
    await store.put("o/a/doc.txt", new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    const held = (await inner.get("o/a/doc.txt"))!;
    await inner.put("o/b/doc.txt", held.bytes, { contentType: held.contentType });
    const flipped = new Uint8Array(held.bytes);
    flipped.set([flipped[flipped.length - 1]! ^ 1], flipped.length - 1);
    await inner.put("o/c/doc.txt", flipped, { contentType: held.contentType });
    await inner.put("o/d/doc.txt", new Uint8Array([9]), { contentType: held.contentType });
    for (const bad of [store.get("o/b/doc.txt"), store.get("o/c/doc.txt"), encryptedStore(inner, randomBytes(32)).get("o/a/doc.txt"), store.get("o/d/doc.txt")]) await expect(bad).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
  });

  it("wants a 32-byte key", () => {
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrowError(/32 bytes/);
    expect(parseEncryptionKey(KEY.toString("base64"))).toHaveLength(32);
    expect(() => encryptedStore(memoryObjectStore(), new Uint8Array(8))).toThrowError(expect.objectContaining({ code: "STORAGE_BAD_SECRET_KEY" }));
  });
});

describe("the vault", () => {
  it("seals a credential and opens it with the same key only", () => {
    const sealed = seal("s3-secret", KEY);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed.includes("s3-secret")).toBe(false);
    expect(seal("s3-secret", KEY)).not.toBe(sealed);
    expect(open(sealed, KEY)).toBe("s3-secret");
    expect(() => open(sealed, randomBytes(32))).toThrowError(expect.objectContaining({ code: "STORAGE_UNREADABLE" }));
    expect(() => open("plain", KEY)).toThrowError(expect.objectContaining({ code: "STORAGE_UNREADABLE" }));
    expect(() => open(`${sealed.slice(0, -2)}AA`, KEY)).toThrowError(expect.objectContaining({ code: "STORAGE_UNREADABLE" }));
  });
  it("wants a 32-byte key", () => expect(() => parseVaultKey("c2hvcnQ=")).toThrowError(/32 bytes/));
});

describe("the region table", () => {
  it("knows Toronto as Canada, Bunny and New York as elsewhere, and is case-insensitive", () => {
    expect(countryOf("TOR1")).toBe("CA");
    expect(residencyOf("ca-central-1")).toBe("canada");
    expect(residencyOf("ny")).toBe("elsewhere");
    expect(residencyOf("nyc3")).toBe("elsewhere");
  });
  it("never claims Canada for a region it does not know", () => {
    expect(countryOf("mars-1")).toBeUndefined();
    expect(residencyOf("")).toBe("elsewhere");
    expect(residencyOf("canada")).toBe("elsewhere");
  });
  it("lists a country for every region and only the Canadian ones are CA", () => {
    expect(Object.entries(COUNTRY_OF_REGION).filter(([, c]) => c === "CA").map(([r]) => r)).not.toContain("ny");
    for (const c of Object.values(COUNTRY_OF_REGION)) expect(c).toMatch(/^[A-Z]{2}$/);
  });
  it("needs the endpoint to agree with the region before it says Canada", () => {
    expect(residencyOfConfig({ provider: "s3", endpoint: "https://tor1.digitaloceanspaces.com", region: "tor1" })).toBe("canada");
    expect(residencyOfConfig({ provider: "s3", endpoint: "https://s3.example.com", region: "ca-central-1" })).toBe("canada");
    expect(residencyOfConfig({ provider: "s3", endpoint: "https://nyc3.digitaloceanspaces.com", region: "tor1" })).toBe("elsewhere");
    expect(residencyOfConfig({ provider: "s3", endpoint: "https://s3.example.com", region: "tor2" })).toBe("elsewhere");
    expect(residencyOfConfig({ provider: "http", endpoint: "storage.bunnycdn.com", region: "tor1" })).toBe("elsewhere");
  });
});

describe("where an object lives", () => {
  const D = { endpoint: null, region: null, residency: "unknown", encrypted: false, owner: "krizaka", devOnly: false } as const;
  const DATABASE: StoreDescriptor = { kind: "database", endpoint: null, region: "tor1", residency: "canada", encrypted: true, owner: "krizaka", devOnly: false };
  const active = { ...D, kind: "s3", endpoint: "tor1.digitaloceanspaces.com", region: "tor1", residency: "canada", encrypted: true } as const;

  it.each([
    ["not kept", { kind: "none" }, { key: "none", vars: {} }],
    ["the database of the Toronto region, encrypted", DATABASE, { key: "krizakaCanadaEncrypted", vars: {} }],
    ["Spaces tor1, encrypted", active, { key: "krizakaCanadaEncrypted", vars: {} }],
    ["Krizaka in Canada, not encrypted", { kind: "s3", residency: "canada" }, { key: "krizakaCanada", vars: {} }],
    ["Krizaka outside Canada says the region", { kind: "s3", region: "eu-west-3", residency: "elsewhere" }, { key: "krizakaElsewhere", vars: { region: "eu-west-3" } }],
    ["the workspace's own storage says host and region", { kind: "s3", owner: "workspace", endpoint: "s3.example.com", region: "ca-central-1", residency: "canada" }, { key: "workspace", vars: { endpoint: "s3.example.com", region: "ca-central-1" } }],
    ["the development store is for fictional data", { kind: "bunny", residency: "elsewhere", devOnly: true }, { key: "devOnly", vars: {} }],
    ["on the device", { kind: "device", owner: "device", residency: "device" }, { key: "device", vars: {} }],
  ] as const)("%s", (_name, override, expected) => expect(storageNotice({ ...D, ...override } as StoreDescriptor)).toEqual(expected));

  it("follows the object's own kind: fixed place, not kept, device, or the active store when it is the same", () => {
    const options = { fixed: { database: DATABASE } };
    expect(where("database", active, options)).toBe(DATABASE);
    expect(where(STORE_KIND.none, active)).toMatchObject({ kind: "none", residency: "unknown", encrypted: false });
    expect(where(STORE_KIND.device, active)).toMatchObject({ kind: "device", owner: "device", residency: "device" });
    expect(where("s3", active)).toBe(active);
  });
  it("a store that is no longer configured says only its kind, residency unknown", () => {
    expect(where("bunny", active, { devOnly: ["bunny"] })).toMatchObject({ kind: "bunny", residency: "unknown", devOnly: true });
    expect(where("s3", { ...active, kind: "http" })).toMatchObject({ kind: "s3", residency: "unknown", devOnly: false });
  });
  it("describes a configured store from the configuration alone", () => {
    expect(describeStore({ provider: "s3", endpoint: "https://tor1.digitaloceanspaces.com", region: "tor1" }, { encrypted: true })).toMatchObject({ kind: "s3", endpoint: "tor1.digitaloceanspaces.com", residency: "canada", encrypted: true });
    expect(describeStore({ provider: "http", endpoint: "storage.bunnycdn.com", region: "" }, { encrypted: false, httpKind: "bunny" })).toMatchObject({ kind: "bunny", devOnly: true, residency: "elsewhere" });
  });
});

describe("the admin over the environment", () => {
  const s3Env: DeploymentStorage = { environment: "prod", provider: "s3", prefix: "yomizaka", s3: { endpoint: "https://tor1.digitaloceanspaces.com", region: "tor1", bucket: "docs", accessKeyId: "id", secretAccessKey: "secret" } };
  const admin = (override: Partial<StorageSettings>): StorageSettings => ({ ...STORAGE_DEFAULTS, provider: "local", endpoint: "", region: "", bucket: "", zone: "", prefix: "", pullHostname: "", publicBaseUrl: "", ...override });

  it("follows the environment when the admin left `local` or chose nothing", () => {
    for (const a of [null, admin({})]) expect(resolveStorage(s3Env, a)).toMatchObject({ provider: "s3", settings: { bucket: "docs", region: "tor1", prefix: "yomizaka" }, descriptor: { residency: "canada" } });
  });
  it("follows the admin's coordinates for every kind of data, avatars included", () => {
    const avatars: DeploymentStorage = { ...s3Env, prefix: "avatars" };
    const chosen = admin({ provider: "s3", region: "nyc3", endpoint: "https://nyc3.digitaloceanspaces.com", bucket: "pics", maxMegabytes: 5 });
    const r = resolveStorage(avatars, chosen);
    expect(r).toMatchObject({ provider: "s3", settings: { bucket: "pics", region: "nyc3", prefix: "avatars", maxMegabytes: 5 }, descriptor: { residency: "elsewhere", region: "nyc3" } });
    expect(r.provider === "s3" && r.secrets.secretAccessKey).toBe("secret");
  });
  it("caps the signed link whatever the admin asks", () => {
    expect(resolveStorage(s3Env, admin({ provider: "s3", signedUrlSeconds: 86_400 }))).toMatchObject({ settings: { signedUrlSeconds: 900 } });
    expect(resolveStorage(s3Env, admin({ signedUrlSeconds: 60 }))).toMatchObject({ settings: { signedUrlSeconds: 60 } });
  });
  it("environment `none` with the admin on `local` keeps nothing", () => {
    expect(resolveStorage({ environment: "prod", provider: "none" }, admin({}))).toEqual({ provider: "none" });
    expect(openResolved({ provider: "none" }, s3Env, { fetch: async () => { throw new Error("no"); }, clock })).toBeNull();
  });
  it("environment `none` with the admin turning keeping on is refused with a typed error, in both providers", () => {
    for (const provider of ["s3", "http"] as const) expect(() => resolveStorage({ environment: "prod", provider: "none" }, admin({ provider }))).toThrowError(expect.objectContaining({ code: "STORAGE_KEEPING_OFF", name: "StorageError" }));
  });
  it("opens the encrypted store when the environment holds a key, and refuses a provider without its keys", async () => {
    const env = { ...s3Env, encryptionKey: KEY.toString("base64") };
    const opened = openResolved(resolveStorage(env, null), env, { fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" }), clock });
    expect(opened?.descriptor.encrypted).toBe(true);
    expect(opened?.store.publicUrl("a/b.txt")).toBeNull();
    const bare = { ...s3Env, s3: { ...s3Env.s3, secretAccessKey: undefined } };
    expect(() => openResolved(resolveStorage(bare, null), bare, { fetch: async () => { throw new Error("no"); }, clock })).toThrowError(expect.objectContaining({ code: "STORAGE_BAD_CONFIG" }));
  });
});
