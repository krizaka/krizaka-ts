import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  checkEndpointDns,
  isPrivateAddress,
  keyIdOf,
  memoryObjectStore,
  type OpenContext,
  openEnvelope,
  openProvider,
  presetEndpoint,
  PROVIDER_KINDS,
  provinceOf,
  residencyLabel,
  rewrapEnvelope,
  seal,
  sealEnvelope,
  StorageError,
  testConnection,
} from "../src/node";

const fetchNever = (() => Promise.reject(new Error("no network"))) as OpenContext["fetch"];
const ctx = (over: Partial<OpenContext> = {}): OpenContext => ({
  runtime: "server",
  environment: "dev",
  fetch: fetchNever,
  clock: { now: () => new Date("2026-10-28T12:00:00Z") },
  ...over,
});
const s3 = { endpoint: "https://tor1.digitaloceanspaces.com", region: "tor1", bucket: "docs" };
const keys = { accessKeyId: "AK", secretAccessKey: "SK" };
const code = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    return (e as StorageError).code;
  }
  return null;
};

describe("the registry", () => {
  it("has one entry per kind, with the rules as data", () => {
    expect(PROVIDER_KINDS.map((k) => k.kind)).toEqual([
      "bunny",
      "s3",
      "managed",
      "dropbox",
      "google-drive",
      "onedrive",
      "azblob",
      "gcs",
      "b2",
      "webdav",
      "folder",
      "device",
    ]);
    expect(PROVIDER_KINDS.find((k) => k.kind === "bunny")).toMatchObject({ devOnly: true, scopes: ["admin"] });
    expect(PROVIDER_KINDS.find((k) => k.kind === "dropbox")?.capabilities.signedUrls).toBe(false);
    expect(PROVIDER_KINDS.find((k) => k.kind === "folder")?.runtimes).toEqual(["dev"]);
  });
  it("fills an S3 preset's endpoint from the region", () => {
    expect(presetEndpoint("digitalocean-spaces", "tor1")).toBe("https://tor1.digitaloceanspaces.com");
    expect(presetEndpoint("ovhcloud", "bhs")).toBe("https://s3.bhs.io.cloud.ovh.net");
    expect(presetEndpoint("generic", "x")).toBeNull();
  });
});

describe("openProvider guards", () => {
  it("opens an S3 provider and says where it lives", async () => {
    const opened = await openProvider("s3", s3, keys, ctx());
    expect(opened.residency).toEqual({ key: "canada-on", country: "CA", province: "ON", text: "Canada (Ontario)" });
  });
  it("refuses bunny in production, never falling back", async () => {
    expect(
      await code(() =>
        openProvider(
          "bunny",
          { endpoint: "ny.storage.bunnycdn.com", zone: "z" },
          { accessKey: "k" },
          ctx({ environment: "prod" }),
        ),
      ),
    ).toBe("STORAGE_BAD_CONFIG");
    expect(
      (await openProvider("bunny", { endpoint: "ny.storage.bunnycdn.com", zone: "z" }, { accessKey: "k" }, ctx()))
        .residency.key,
    ).toBe("elsewhere");
  });
  it("refuses the folder outside dev: the web never writes the server's disk", async () => {
    expect(await code(() => openProvider("folder", { root: "/tmp/x" }, {}, ctx({ runtime: "server" })))).toBe(
      "STORAGE_BAD_CONFIG",
    );
    expect(await code(() => openProvider("folder", { root: "/tmp/x" }, {}, ctx({ runtime: "device" })))).toBe(
      "STORAGE_BAD_CONFIG",
    );
    expect(await code(() => openProvider("folder", { root: "/tmp/x" }, {}, ctx({ runtime: "dev" })))).toBeNull();
  });
  it("refuses an unknown or unimplemented kind, a missing field, and a private endpoint", async () => {
    expect(await code(() => openProvider("ftp", {}, {}, ctx()))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => openProvider("google-drive", {}, { refreshToken: "t" }, ctx()))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => openProvider("google-drive", { clientId: "cid" }, {}, ctx()))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => openProvider("dropbox", {}, { refreshToken: "t" }, ctx()))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => openProvider("device", {}, {}, ctx({ runtime: "server" })))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => openProvider("s3", { ...s3, bucket: "" }, keys, ctx()))).toBe("STORAGE_BAD_CONFIG");
    expect(await code(() => openProvider("s3", { ...s3, endpoint: "https://10.0.0.1" }, keys, ctx()))).toBe(
      "STORAGE_BAD_ENDPOINT",
    );
  });
});

describe("province table", () => {
  it("names the province, and says Canada only when region and endpoint agree", () => {
    expect(provinceOf("ca-central-1")).toBe("QC");
    expect(provinceOf("bhs")).toBe("QC");
    expect(provinceOf("tor1")).toBe("ON");
    expect(provinceOf("ca-west-1")).toBe("AB");
    expect(
      residencyLabel({ provider: "s3", endpoint: "https://s3.ca-central-1.amazonaws.com", region: "ca-central-1" })
        .text,
    ).toBe("Canada (Québec)");
    expect(
      residencyLabel({ provider: "s3", endpoint: "https://nyc3.digitaloceanspaces.com", region: "tor1" }).key,
    ).toBe("elsewhere");
    expect(residencyLabel({ provider: "s3", endpoint: "https://s3.example.com", region: "moon" }).key).toBe(
      "elsewhere",
    );
  });
});

describe("testConnection", () => {
  it("passes on a working store and leaves no probe", async () => {
    const store = memoryObjectStore();
    const out = await testConnection(store, "p1", () => 0);
    expect(out.ok).toBe(true);
    expect(out.steps.map((s) => s.name)).toEqual(["write", "read", "delete"]);
    expect(await store.list("")).toEqual([]);
  });
  it("reports a failing write without a value and stops there", async () => {
    const store = { ...memoryObjectStore(), put: () => Promise.reject(new Error("403 denied")) };
    const out = await testConnection(store, "p2", () => 0);
    expect(out.ok).toBe(false);
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]?.error).toBe("403 denied");
  });
  it("fails when what is read is not what was written", async () => {
    const inner = memoryObjectStore();
    const store = {
      ...inner,
      get: async (k: string) => (await inner.get(k)) && { bytes: new Uint8Array([1]), contentType: "text/plain" },
    };
    expect((await testConnection(store, "p3", () => 0)).ok).toBe(false);
  });
});

describe("DNS check", () => {
  it("knows private addresses, v4 and v6", () => {
    for (const a of [
      "10.1.1.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPrivateAddress(a)).toBe(true);
    for (const a of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(a)).toBe(false);
  });
  it("refuses a name that resolves to a private address, or not at all", async () => {
    await expect(
      checkEndpointDns("https://evil.example.com", { resolve: async () => ["10.0.0.5"] }),
    ).rejects.toMatchObject({ code: "STORAGE_BAD_ENDPOINT" });
    await expect(checkEndpointDns("https://nowhere.example.com", { resolve: async () => [] })).rejects.toMatchObject({
      code: "STORAGE_BAD_ENDPOINT",
    });
    await expect(checkEndpointDns("https://ok.example.com", { resolve: async () => ["93.184.216.34"] })).resolves.toBe(
      "https://ok.example.com",
    );
    await expect(checkEndpointDns("http://localhost:9000", { allowLocal: true })).resolves.toBe(
      "http://localhost:9000",
    );
  });
});

describe("envelope vault", () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  it("seals under a data key wrapped by the key named in the value", () => {
    const sealed = sealEnvelope('{"secretAccessKey":"abc"}', k1, "k1");
    expect(sealed.startsWith("v2.k1.")).toBe(true);
    expect(sealed).not.toContain("abc");
    expect(keyIdOf(sealed)).toBe("k1");
    expect(openEnvelope(sealed, { keys: { k1 } })).toBe('{"secretAccessKey":"abc"}');
    expect(sealEnvelope("x", k1, "k1")).not.toBe(sealEnvelope("x", k1, "k1"));
  });
  it("still opens v1 values with the legacy key", () => {
    expect(openEnvelope(seal("old", k1), { keys: {}, legacy: k1 })).toBe("old");
    expect(keyIdOf(seal("old", k1))).toBeNull();
  });
  it("refuses a wrong key, a missing key id, tampering and a bad id", () => {
    const sealed = sealEnvelope("s", k1, "k1");
    expect(() => openEnvelope(sealed, { keys: { k1: k2 } })).toThrow(/integrity/);
    expect(() => openEnvelope(sealed, { keys: { other: k1 } })).toThrow(/No vault key k1/);
    expect(() => openEnvelope(sealed.slice(0, -2) + "AA", { keys: { k1 } })).toThrow(StorageError);
    expect(() => sealEnvelope("s", k1, "bad.id")).toThrow(StorageError);
  });
  it("rotates the key-encryption key by re-wrapping only: the secret body is untouched", () => {
    const sealed = sealEnvelope("s3cret", k1, "k1");
    const next = rewrapEnvelope(sealed, { keys: { k1 } }, { keyId: "k2", key: k2 });
    expect(keyIdOf(next)).toBe("k2");
    expect(next.split(".")[3]).toBe(sealed.split(".")[3]);
    expect(openEnvelope(next, { keys: { k2 } })).toBe("s3cret");
    expect(() => openEnvelope(next, { keys: { k1 } })).toThrow();
    const fromV1 = rewrapEnvelope(seal("legacy", k1), { keys: {}, legacy: k1 }, { keyId: "k2", key: k2 });
    expect(openEnvelope(fromV1, { keys: { k2 } })).toBe("legacy");
  });
});
