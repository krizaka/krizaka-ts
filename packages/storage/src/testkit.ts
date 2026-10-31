import { expect, it } from "vitest";

import type { KeyService } from "./key-service";
import type { ObjectStore } from "./port";
import type { ProviderRecord, ProviderStore } from "./provider-records";
import type { TenantKeyStore } from "./tenant-keys";

const bytes = (...n: number[]) => new Uint8Array(n);

/** What every `ObjectStore` adapter must do: the same behaviour behind the same port. `make` gives an empty store. */
export function objectStoreContract(name: string, make: () => ObjectStore | Promise<ObjectStore>) {
  it(`${name}: stores a file and reads it back byte for byte`, async () => {
    const store = await make();
    await store.put("site/home/a.b1.png", bytes(1, 2, 3, 255), { contentType: "image/png" });
    const got = await store.get("site/home/a.b1.png");
    expect([...got!.bytes]).toEqual([1, 2, 3, 255]);
    expect(got!.contentType).toBe("image/png");
    expect(await store.head("site/home/a.b1.png")).toEqual({ key: "site/home/a.b1.png", size: 4 });
  });

  it(`${name}: answers null for a missing file, and deleting it twice is fine`, async () => {
    const store = await make();
    expect(await store.get("missing/file.txt")).toBeNull();
    expect(await store.head("missing/file.txt")).toBeNull();
    await store.put("x/y.txt", bytes(1), { contentType: "text/plain" });
    await store.delete("x/y.txt");
    await store.delete("x/y.txt");
    expect(await store.get("x/y.txt")).toBeNull();
  });

  it(`${name}: overwrites a key`, async () => {
    const store = await make();
    await store.put("k/f.bin", bytes(1), { contentType: "application/octet-stream" });
    await store.put("k/f.bin", bytes(9, 9), { contentType: "application/octet-stream" });
    expect([...(await store.get("k/f.bin"))!.bytes]).toEqual([9, 9]);
  });

  it(`${name}: lists the files under a prefix, directories flattened, in key order`, async () => {
    const store = await make();
    for (const key of ["a/one.txt", "a/b/two.txt", "a/b/c/three.txt", "other/four.txt", "a-b/five.txt"])
      await store.put(key, bytes(7), { contentType: "text/plain" });
    expect((await store.list("a/")).map((f) => f.key)).toEqual(["a/b/c/three.txt", "a/b/two.txt", "a/one.txt"]);
    expect((await store.list("a/b/")).map((f) => f.key)).toEqual(["a/b/c/three.txt", "a/b/two.txt"]);
    expect(await store.list("nothing/")).toEqual([]);
    expect((await store.list("a/o")).map((f) => f.key)).toEqual(["a/one.txt"]);
  });

  it(`${name}: refuses a key that climbs out, is empty or has a bad segment`, async () => {
    const store = await make();
    for (const key of ["../x.txt", "a/../b.txt", "/abs.txt", "a//b.txt", "a/b/", "", "a\\b.txt"])
      await expect(store.put(key, bytes(1), { contentType: "text/plain" })).rejects.toMatchObject({
        code: "STORAGE_BAD_KEY",
      });
  });
}

const sample = (id: string, over: Partial<ProviderRecord> = {}): ProviderRecord => ({
  id,
  scope: "org",
  kind: "s3",
  preset: null,
  label: `Provider ${id.slice(-1)}`,
  coordinates: { endpoint: "https://tor1.digitaloceanspaces.com", region: "tor1", bucket: "b" },
  sealedCredentials: "v2.k1.a.b",
  keyId: "k1",
  status: "draft",
  source: "admin",
  lastTest: null,
  createdBy: null,
  createdAt: new Date("2026-10-28T10:00:00Z"),
  updatedAt: new Date("2026-10-28T10:00:00Z"),
  ...over,
});

/** What every `ProviderStore` must do. `make` gives an empty store; ids are UUIDs. */
export function providerStoreContract(name: string, make: () => ProviderStore | Promise<ProviderStore>) {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  it(`${name}: stores a provider and reads it back whole`, async () => {
    const store = await make();
    const record = sample(A, {
      lastTest: {
        ok: true,
        at: new Date("2026-10-28T11:00:00Z"),
        steps: [{ name: "write", ok: true, ms: 3 }],
        residency: { key: "canada-on", country: "CA", province: "ON", text: "Canada (Ontario)" },
      },
    });
    await store.insert(record);
    expect(await store.get(A)).toEqual(record);
    expect(await store.get(B)).toBeNull();
  });
  it(`${name}: lists by scope, oldest first, and updates a patch`, async () => {
    const store = await make();
    await store.insert(sample(B, { createdAt: new Date("2026-10-28T12:00:00Z") }));
    await store.insert(sample(A));
    await store.insert(sample("00000000-0000-4000-8000-00000000000c", { scope: "user:u1" }));
    expect((await store.list("org")).map((r) => r.id)).toEqual([A, B]);
    expect(await store.list()).toHaveLength(3);
    const next = await store.update(A, {
      status: "verified",
      label: "Renamed",
      coordinates: { endpoint: "https://x.example.com" },
    });
    expect(next).toMatchObject({
      id: A,
      status: "verified",
      label: "Renamed",
      coordinates: { endpoint: "https://x.example.com" },
    });
    expect(await store.update(B, {})).toMatchObject({ id: B });
    expect(await store.update("00000000-0000-4000-8000-0000000000ff", { status: "active" })).toBeNull();
  });
  it(`${name}: keeps one default per scope and kind of data`, async () => {
    const store = await make();
    await store.insert(sample(A));
    await store.insert(sample(B));
    expect(await store.defaultFor("org", "documents")).toBeNull();
    await store.setDefault("org", "documents", A);
    await store.setDefault("org", "avatars", A);
    await store.setDefault("org", "documents", B);
    expect(await store.defaultFor("org", "documents")).toBe(B);
    expect(await store.defaults("org")).toEqual({ documents: B, avatars: A });
    expect(await store.defaults("user:u1")).toEqual({});
  });
}

/** What every `KeyService` (KMS) adapter must do. `make` gives a service whose root key is usable. */
export function keyServiceContract(name: string, make: () => KeyService | Promise<KeyService>) {
  const key = new Uint8Array(32).map((_, i) => i + 1);
  it(`${name}: unwraps what it wrapped, under the same context`, async () => {
    const kms = await make();
    const wrapped = await kms.wrap(key, { tenant: "a" });
    expect(wrapped.ciphertext).not.toContain(Buffer.from(key).toString("base64"));
    expect([...(await kms.unwrap(wrapped, { tenant: "a" }))]).toEqual([...key]);
    expect(typeof (await kms.currentKeyId())).toBe("string");
  });
  it(`${name}: refuses another tenant's context`, async () => {
    const kms = await make();
    const wrapped = await kms.wrap(key, { tenant: "a" });
    await expect(kms.unwrap(wrapped, { tenant: "b" })).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
  });
  it(`${name}: refuses a changed ciphertext`, async () => {
    const kms = await make();
    const wrapped = await kms.wrap(key, { tenant: "a" });
    const raw = Buffer.from(wrapped.ciphertext, "base64");
    raw[raw.length - 1] = (raw.at(-1) ?? 0) ^ 1;
    await expect(kms.unwrap({ ...wrapped, ciphertext: raw.toString("base64") }, { tenant: "a" })).rejects.toMatchObject(
      {
        code: "STORAGE_UNREADABLE",
      },
    );
  });
  it(`${name}: still unwraps after a rotation, when it rotates`, async () => {
    const kms = await make();
    if (!kms.rotate) return;
    const before = await kms.wrap(key, { tenant: "a" });
    await kms.rotate();
    expect([...(await kms.unwrap(before, { tenant: "a" }))]).toEqual([...key]);
  });
}

/** What every `TenantKeyStore` must do. `make` gives an empty store. */
export function tenantKeyStoreContract(name: string, make: () => TenantKeyStore | Promise<TenantKeyStore>) {
  const at = new Date("2026-10-31T10:00:00Z");
  const k = (tenantId: string, version: number, keyId = "root:1") => ({
    tenantId,
    version,
    wrapped: { keyId, ciphertext: `c-${tenantId}-${version}` },
    createdAt: at,
  });
  it(`${name}: keeps the versions of a tenant, oldest first, and refuses a duplicate version`, async () => {
    const store = await make();
    expect(await store.versions("t1")).toEqual([]);
    expect(await store.insert(k("t1", 2))).toBe(true);
    expect(await store.insert(k("t1", 1))).toBe(true);
    expect(await store.insert(k("t1", 1, "other"))).toBe(false);
    expect(await store.insert(k("t2", 1))).toBe(true);
    expect((await store.versions("t1")).map((v) => [v.version, v.wrapped.keyId])).toEqual([
      [1, "root:1"],
      [2, "root:1"],
    ]);
    expect(await store.tenants()).toEqual(["t1", "t2"]);
  });
  it(`${name}: rewraps and drops one version`, async () => {
    const store = await make();
    await store.insert(k("t1", 1));
    await store.insert(k("t1", 2));
    await store.rewrap("t1", 1, { keyId: "root:2", ciphertext: "new" });
    await store.drop("t1", 2);
    expect(await store.versions("t1")).toEqual([{ ...k("t1", 1), wrapped: { keyId: "root:2", ciphertext: "new" } }]);
  });
  it(`${name}: a shredded tenant loses every version and never gets one back`, async () => {
    const store = await make();
    await store.insert(k("t1", 1));
    await store.insert(k("t2", 1));
    await store.shred("t1", at);
    await store.shred("t1", new Date("2027-01-01T00:00:00Z"));
    expect(await store.versions("t1")).toEqual([]);
    expect((await store.shreddedAt("t1"))?.toISOString()).toBe(at.toISOString());
    expect(await store.shreddedAt("t2")).toBeNull();
    expect(await store.insert(k("t1", 2))).toBe(false);
    expect(await store.versions("t1")).toEqual([]);
    expect(await store.tenants()).toEqual(["t2"]);
  });
}
