import { describe, expect, it } from "vitest";

import {
  cloudKeyService,
  type FetchLike,
  type KeyAuditNote,
  memoryKeyService,
  memoryObjectStore,
  memoryTenantKeyStore,
  type ObjectStore,
  type TenantKeyStore,
  tenantStore,
  tenantVault,
} from "../src/node";
import { keyServiceContract, objectStoreContract, tenantKeyStoreContract } from "../src/testkit";

const clock = { now: () => new Date("2026-10-31T10:00:00Z") };
const text = (s: string) => new TextEncoder().encode(s);

function setup(over: { keys?: TenantKeyStore; kms?: ReturnType<typeof memoryKeyService>; cacheSeconds?: number } = {}) {
  const kms = over.kms ?? memoryKeyService();
  const keys = over.keys ?? memoryTenantKeyStore();
  const audit: KeyAuditNote[] = [];
  const vault = tenantVault({
    kms,
    keys,
    clock,
    audit: async (n) => {
      audit.push(n);
    },
    cacheSeconds: over.cacheSeconds ?? 0,
  });
  const bucket = memoryObjectStore();
  return { kms, keys, audit, vault, bucket, store: (tenant: string) => tenantStore(bucket, vault, tenant) };
}

/** A KMS server in a test: answers the AWS KMS JSON API and the OKMS REST API over a local key service, and records each request. */
function fakeKms() {
  const local = memoryKeyService();
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const ok = (value: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => JSON.stringify(value),
  });
  const refused = { ...ok({}), ok: false, status: 400 };
  const contextOf = (raw: unknown) =>
    typeof raw === "string"
      ? Object.fromEntries(raw.split("&").map((p) => p.split("=") as [string, string]))
      : (raw as Record<string, string>);
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(new TextDecoder().decode(init.body)) as Record<string, string>;
    seen.push({ url, headers: init.headers, body });
    try {
      const target = init.headers["x-amz-target"];
      if (target === "TrentService.Encrypt") {
        const w = await local.wrap(Buffer.from(body.Plaintext!, "base64"), contextOf(body.EncryptionContext));
        return ok({ CiphertextBlob: Buffer.from(JSON.stringify(w)).toString("base64"), KeyId: "arn:aws:kms:k1" });
      }
      if (target === "TrentService.Decrypt") {
        const w = JSON.parse(Buffer.from(body.CiphertextBlob!, "base64").toString()) as {
          keyId: string;
          ciphertext: string;
        };
        return ok({
          Plaintext: Buffer.from(await local.unwrap(w, contextOf(body.EncryptionContext))).toString("base64"),
        });
      }
      if (target === "TrentService.RotateKeyOnDemand") {
        await local.rotate();
        return ok({});
      }
      if (url.endsWith("/encrypt")) {
        const w = await local.wrap(Buffer.from(body.plaintext!, "base64"), contextOf(body.context));
        return ok({ ciphertext: Buffer.from(JSON.stringify(w)).toString("base64") });
      }
      const w = JSON.parse(Buffer.from(body.ciphertext!, "base64").toString()) as { keyId: string; ciphertext: string };
      return ok({ plaintext: Buffer.from(await local.unwrap(w, contextOf(body.context))).toString("base64") });
    } catch {
      return refused;
    }
  };
  return { fetch, seen };
}

describe("KeyService adapters", () => {
  keyServiceContract("memory", () => memoryKeyService());
  keyServiceContract("aws-kms (recorded API)", () =>
    cloudKeyService(
      { kind: "aws-kms", region: "ca-central-1", keyId: "alias/docs", accessKeyId: "AKIA-test", secretAccessKey: "s" },
      { fetch: fakeKms().fetch, clock },
    ),
  );
  keyServiceContract("okms (recorded API)", () =>
    cloudKeyService(
      { kind: "okms", endpoint: "https://ca-east-bhs.okms.ovh.net/", okmsId: "o-1", keyId: "k-1" },
      { fetch: fakeKms().fetch, clock },
    ),
  );

  it("aws-kms signs every call and binds the tenant in the encryption context", async () => {
    const server = fakeKms();
    const kms = cloudKeyService(
      { kind: "aws-kms", region: "ca-central-1", keyId: "alias/docs", accessKeyId: "AKIA-test", secretAccessKey: "s" },
      { fetch: server.fetch, clock },
    );
    await kms.wrap(new Uint8Array(32), { tenant: "a" });
    const call = server.seen[0]!;
    expect(call.url).toBe("https://kms.ca-central-1.amazonaws.com/");
    expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA-test\/20261031\/ca-central-1\/kms\//);
    expect(call.headers.authorization).toContain("x-amz-target");
    expect(call.body).toMatchObject({ KeyId: "alias/docs", EncryptionContext: { tenant: "a" } });
    expect(JSON.stringify(server.seen)).not.toContain('"s"');
  });

  it("okms calls the service key of the admin's KMS, with the tenant as context", async () => {
    const server = fakeKms();
    const kms = cloudKeyService(
      { kind: "okms", endpoint: "https://ca-east-bhs.okms.ovh.net/", okmsId: "o-1", keyId: "k-1" },
      { fetch: server.fetch, clock },
    );
    const wrapped = await kms.wrap(new Uint8Array(32), { tenant: "a" });
    expect(wrapped.keyId).toBe("k-1");
    expect(server.seen[0]!.url).toBe("https://ca-east-bhs.okms.ovh.net/api/o-1/v1/servicekey/k-1/encrypt");
    expect(server.seen[0]!.body.context).toBe("tenant=a");
    expect(kms.rotate).toBeUndefined();
  });

  it("a KMS that is down is a provider failure, not an unreadable key", async () => {
    const down: FetchLike = async () => ({
      ok: false,
      status: 503,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    });
    const kms = cloudKeyService(
      { kind: "okms", endpoint: "https://kms.example", okmsId: "o", keyId: "k" },
      { fetch: down, clock },
    );
    await expect(kms.wrap(new Uint8Array(32), { tenant: "a" })).rejects.toMatchObject({
      code: "STORAGE_PROVIDER_FAILED",
    });
  });
});

describe("TenantKeyStore", () => {
  tenantKeyStoreContract("memory", () => memoryTenantKeyStore());
});

describe("tenantStore: the managed storage's envelope", () => {
  objectStoreContract("tenantStore over memory", () => setup().store("tenant-a"));

  it("the bucket holds ciphertext only, under t/<tenant>/", async () => {
    const { bucket, store } = setup();
    await store("a").put("docs/lease.pdf", text("Bail de Marie, NAS 123 456 789"), { contentType: "application/pdf" });
    const raw = await bucket.get("t/a/docs/lease.pdf");
    expect(Buffer.from(raw!.bytes).toString("latin1")).not.toContain("Marie");
    expect(Buffer.from(raw!.bytes).toString("latin1")).not.toContain("application/pdf");
    expect(raw!.contentType).toBe("application/octet-stream");
    expect((await store("a").list("docs/")).map((o) => o.key)).toEqual(["docs/lease.pdf"]);
  });

  it("tenant B cannot name, list or open tenant A's object, even copied into its own space", async () => {
    const { bucket, store } = setup();
    await store("a").put("x/secret.txt", text("A only"), { contentType: "text/plain" });
    expect(await store("b").get("x/secret.txt")).toBeNull();
    expect(await store("b").list("")).toEqual([]);
    await expect(store("b").get("../a/x/secret.txt")).rejects.toMatchObject({ code: "STORAGE_BAD_KEY" });
    const raw = await bucket.get("t/a/x/secret.txt");
    await bucket.put("t/b/x/secret.txt", raw!.bytes, { contentType: "application/octet-stream" });
    await store("b").put("other.txt", text("B's own"), { contentType: "text/plain" }); // B has a key of its own
    await expect(store("b").get("x/secret.txt")).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
  });

  it("an object renamed inside the tenant does not open", async () => {
    const { bucket, store } = setup();
    await store("a").put("one.txt", text("1"), { contentType: "text/plain" });
    const raw = await bucket.get("t/a/one.txt");
    await bucket.put("t/a/two.txt", raw!.bytes, { contentType: "application/octet-stream" });
    await expect(store("a").get("two.txt")).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
  });

  it("any changed byte — format, key version, wrapped key, body, tag — is refused", async () => {
    const { bucket, store } = setup();
    await store("a").put("f.bin", text("payload of some length"), { contentType: "application/octet-stream" });
    const raw = (await bucket.get("t/a/f.bin"))!.bytes;
    for (const at of [0, 4, 10, 70, 80, raw.length - 1]) {
      const bad = new Uint8Array(raw);
      bad[at] = bad[at]! ^ 0x01;
      await bucket.put("t/a/f.bin", bad, { contentType: "application/octet-stream" });
      await expect(store("a").get("f.bin")).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
    }
    await bucket.put("t/a/f.bin", raw.subarray(0, 40), { contentType: "application/octet-stream" });
    await expect(store("a").get("f.bin")).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
  });

  it("refuses a malformed tenant id", () => {
    const { bucket, vault } = setup();
    for (const bad of ["", "a/b", "../x", "x".repeat(65), "é"])
      expect(() => tenantStore(bucket, vault, bad)).toThrow(expect.objectContaining({ code: "STORAGE_BAD_KEY" }));
  });

  it("first use from many requests at once makes one key, and every object opens", async () => {
    const { keys, store, audit } = setup();
    const s = store("busy");
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => s.put(`f${i}.txt`, text(`n${i}`), { contentType: "text/plain" })),
    );
    expect((await keys.versions("busy")).map((k) => k.version)).toEqual([1]);
    expect(audit.filter((n) => n.action === "storage.key.created")).toHaveLength(1);
    for (let i = 0; i < 12; i += 1) expect(new TextDecoder().decode((await s.get(`f${i}.txt`))!.bytes)).toBe(`n${i}`);
  });
});

describe("rotation and rewrap", () => {
  it("rotating a tenant key: new objects use v2, old ones still open; rewrap moves them, then v1 can go", async () => {
    const { vault, keys, bucket, store, audit } = setup();
    const s = store("a");
    await s.put("old.txt", text("before"), { contentType: "text/plain" });
    const bodyBefore = Buffer.from((await bucket.get("t/a/old.txt"))!.bytes).subarray(65);
    expect(await vault.rotateTenant("a")).toBe(2);
    await s.put("new.txt", text("after"), { contentType: "text/plain" });
    expect(new TextDecoder().decode((await s.get("old.txt"))!.bytes)).toBe("before");
    expect(await s.rewrapAll()).toBe(1);
    expect(await s.rewrapAll()).toBe(0);
    // The bytes are never re-encrypted: only the header changed.
    expect(
      Buffer.from((await bucket.get("t/a/old.txt"))!.bytes)
        .subarray(65)
        .equals(bodyBefore),
    ).toBe(true);
    expect(await vault.dropOldVersions("a")).toBe(1);
    expect((await keys.versions("a")).map((k) => k.version)).toEqual([2]);
    expect(new TextDecoder().decode((await s.get("old.txt"))!.bytes)).toBe("before");
    expect(new TextDecoder().decode((await s.get("new.txt"))!.bytes)).toBe("after");
    expect(audit.map((n) => n.action)).toEqual(["storage.key.created", "storage.key.rotated"]);
  });

  it("an object left on a dropped version is refused, never opened with another key", async () => {
    const { vault, store } = setup();
    const s = store("a");
    await s.put("old.txt", text("before"), { contentType: "text/plain" });
    await vault.rotateTenant("a");
    await vault.dropOldVersions("a");
    await expect(s.get("old.txt")).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
  });

  it("rotating the root key rewraps every tenant key once; then the old root can be destroyed", async () => {
    const { kms, vault, store, audit } = setup();
    await store("a").put("f.txt", text("A"), { contentType: "text/plain" });
    await store("b").put("f.txt", text("B"), { contentType: "text/plain" });
    const old = await kms.currentKeyId();
    await kms.rotate();
    expect(await vault.rewrapRoot()).toEqual({ tenants: 2, rewrapped: 2 });
    expect(await vault.rewrapRoot()).toEqual({ tenants: 2, rewrapped: 0 });
    expect(await vault.rewrapRoot({ force: true })).toEqual({ tenants: 2, rewrapped: 2 });
    kms.destroy(old);
    expect(new TextDecoder().decode((await store("a").get("f.txt"))!.bytes)).toBe("A");
    expect(new TextDecoder().decode((await store("b").get("f.txt"))!.bytes)).toBe("B");
    expect(audit.filter((n) => n.action === "storage.key.rewrapped")).toHaveLength(4);
  });
});

describe("crypto-shredding", () => {
  it("a shredded tenant's objects never open again — not even from a raw copy with the KMS intact", async () => {
    const { vault, bucket, store, keys, audit } = setup();
    await store("gone").put("lease.pdf", text("secret"), { contentType: "application/pdf" });
    await store("kept").put("lease.pdf", text("kept"), { contentType: "application/pdf" });
    const copy = (await bucket.get("t/gone/lease.pdf"))!.bytes; // a backup, the replica
    await vault.shredTenant("gone");
    await expect(store("gone").get("lease.pdf")).rejects.toMatchObject({ code: "STORAGE_TENANT_SHREDDED" });
    await expect(vault.open("gone", "t/gone/lease.pdf", copy)).rejects.toMatchObject({
      code: "STORAGE_TENANT_SHREDDED",
    });
    await expect(store("gone").put("new.txt", text("x"), { contentType: "text/plain" })).rejects.toMatchObject({
      code: "STORAGE_TENANT_SHREDDED",
    });
    expect(await keys.versions("gone")).toEqual([]);
    expect(new TextDecoder().decode((await store("kept").get("lease.pdf"))!.bytes)).toBe("kept");
    expect(audit.at(-1)).toMatchObject({
      action: "storage.key.shredded",
      target: { id: "gone" },
      detail: { versions: 1 },
    });
  });

  it("a shred by another process takes effect here at once, cache or not", async () => {
    const keys = memoryTenantKeyStore();
    const kms = memoryKeyService();
    const mk = () => tenantVault({ kms, keys, clock, audit: async () => {}, cacheSeconds: 60 });
    const here = mk();
    const bucket: ObjectStore = memoryObjectStore();
    const s = tenantStore(bucket, here, "t");
    await s.put("f.txt", text("x"), { contentType: "text/plain" });
    await mk().shredTenant("t");
    await expect(s.get("f.txt")).rejects.toMatchObject({ code: "STORAGE_TENANT_SHREDDED" });
  });
});
