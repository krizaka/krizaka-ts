import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { opendalStore, storageErrorOf } from "../src/opendal";
import { EMPTY_SHA256, signRequest } from "../src/request-signing";
import { objectStoreContract } from "../src/testkit";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
const freshFolder = () => {
  const folder = mkdtempSync(join(tmpdir(), "kz-opendal-"));
  folders.push(folder);
  return folder;
};

describe("opendalStore on the local disk (fs, development only)", () => {
  objectStoreContract("opendal fs", () => opendalStore({ service: "fs", options: { root: freshFolder() }, allowLocal: true }));
  objectStoreContract("opendal fs under a prefix", () => opendalStore({ service: "fs", options: { root: freshFolder() }, prefix: "tenant-1", allowLocal: true }));

  it("streams a large file back without reading it whole", async () => {
    const store = await opendalStore({ service: "fs", options: { root: freshFolder() }, allowLocal: true });
    const big = new Uint8Array(6 * 1024 * 1024).map((_, i) => i % 251);
    await store.put("big/file.bin", big, { contentType: "application/octet-stream" });
    let length = 0;
    let chunks = 0;
    for await (const chunk of await store.readStream("big/file.bin")) {
      length += (chunk as Buffer).length;
      chunks += 1;
    }
    expect(length).toBe(big.length);
    expect(chunks).toBeGreaterThan(1);
    expect(await store.signedUrl("big/file.bin", 60)).toBeNull();
    expect(store.publicUrl("big/file.bin")).toBeNull();
  });
});

describe("opendalStore guards", () => {
  it("opens only the listed services: no database, cache or unknown scheme", async () => {
    for (const service of ["postgresql", "redis", "http", "sqlite", "nope"]) await expect(opendalStore({ service, options: {} })).rejects.toMatchObject({ code: "STORAGE_BAD_CONFIG" });
  });

  it("refuses the server's disk and memory without allowLocal", async () => {
    await expect(opendalStore({ service: "fs", options: { root: "/tmp" } })).rejects.toMatchObject({ code: "STORAGE_BAD_CONFIG" });
    await expect(opendalStore({ service: "memory", options: {} })).rejects.toMatchObject({ code: "STORAGE_BAD_CONFIG" });
  });

  it("refuses an OAuth cloud without a connected account", async () => {
    await expect(opendalStore({ service: "gdrive", options: {} })).rejects.toMatchObject({ code: "STORAGE_BAD_CONFIG" });
  });

  it("keeps the SSRF guards: http, link-local, private and a name resolving inside the network", async () => {
    const s3 = (endpoint: string, resolve?: (host: string) => Promise<string[]>) => opendalStore({ service: "s3", options: { bucket: "b", region: "us-east-1", endpoint }, ...(resolve ? { resolve } : {}) });
    for (const endpoint of ["http://s3.example.com", "https://169.254.169.254", "https://10.0.0.2", "https://localhost", "https://[fe80::1]", "https://user:pw@s3.example.com"]) await expect(s3(endpoint)).rejects.toMatchObject({ code: "STORAGE_BAD_ENDPOINT" });
    await expect(s3("https://s3.example.com", async () => ["169.254.169.254"])).rejects.toMatchObject({ code: "STORAGE_BAD_ENDPOINT" });
    await expect(opendalStore({ service: "webdav", options: { endpoint: "https://192.168.1.10/dav" } })).rejects.toMatchObject({ code: "STORAGE_BAD_ENDPOINT" });
  });

  it("opens a public endpoint once it passes the checks", async () => {
    const store = await opendalStore({ service: "s3", options: { bucket: "b", region: "ca-central-1", endpoint: "https://s3.ca-central-1.amazonaws.com", access_key_id: "AKIDEXAMPLE", secret_access_key: "demo" }, resolve: async () => ["52.94.0.1"] });
    expect(await store.signedUrl("a/b.pdf", 900)).toMatch(/^https:\/\/s3\.ca-central-1\.amazonaws\.com\/b\/a\/b\.pdf\?.*X-Amz-Expires=900/);
  });

  it("maps OpenDAL's error kinds onto the package's codes, without quoting the provider", () => {
    expect(storageErrorOf(new Error("PermissionDenied (permanent) at read => token expired"), "oauth", "download").code).toBe("STORAGE_DISCONNECTED");
    expect(storageErrorOf(new Error("PermissionDenied (permanent) at read"), "keys", "download").code).toBe("STORAGE_PROVIDER_FAILED");
    expect(storageErrorOf(new Error("ConfigInvalid (permanent) at  => bucket"), "keys", "connection").code).toBe("STORAGE_BAD_CONFIG");
    const unexpected = storageErrorOf(new Error("Unexpected (temporary) at write => secret-ish detail"), "keys", "upload");
    expect(unexpected.code).toBe("STORAGE_PROVIDER_FAILED");
    expect(unexpected.message).not.toContain("secret-ish");
  });

  it("an OAuth cloud whose token is refused answers STORAGE_DISCONNECTED (fake WebDAV-less run: the token source fails)", async () => {
    const store = await opendalStore({ service: "dropbox", options: { root: "/" }, accessToken: async () => Promise.reject(storageErrorOf(new Error("PermissionDenied (permanent)"), "oauth", "token")) });
    await expect(store.get("a/b.txt")).rejects.toMatchObject({ code: "STORAGE_DISCONNECTED" });
  });
});

/**
 * A real S3-compatible server in a container (CI sets STORAGE_S3_IT=1; locally with Docker running). SeaweedFS (Apache-2.0): MinIO's
 * public images left Docker Hub and Quay, so they cannot be pulled without an account any more.
 */
describe.runIf(process.env.STORAGE_S3_IT === "1")("opendalStore on an S3-compatible server (SeaweedFS)", () => {
  let server: StartedTestContainer;
  let endpoint = "";
  const keys = { access_key_id: "s3-ci", secret_access_key: "s3-ci-only-demo" };
  const identities = { identities: [{ name: "ci", credentials: [{ accessKey: keys.access_key_id, secretKey: keys.secret_access_key }], actions: ["Admin", "Read", "Write", "List", "Tagging"] }] };
  let bucket = 0;
  beforeAll(async () => {
    server = await new GenericContainer("chrislusf/seaweedfs:3.97")
      .withCopyContentToContainer([{ content: JSON.stringify(identities), target: "/etc/s3.json" }])
      .withCommand(["server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/s3.json"])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forLogMessage(/Start Seaweed S3 API Server/))
      .start();
    endpoint = `http://${server.getHost()}:${server.getMappedPort(8333)}`;
  }, 180_000);
  afterAll(async () => {
    await server?.stop();
  });

  const fresh = async () => {
    bucket += 1;
    const name = `kz-${bucket}`;
    // OpenDAL does not create buckets: a signed PUT on the bucket does (the admin creates it at the provider in real life).
    const res = await fetch(`${endpoint}/${name}`, { method: "PUT", headers: await signedPut(name) });
    expect(res.status).toBe(200);
    return opendalStore({ service: "s3", options: { bucket: name, region: "us-east-1", endpoint, ...keys }, allowLocal: true });
  };
  const signedPut = async (name: string) => signRequest({ accessKeyId: keys.access_key_id, secretAccessKey: keys.secret_access_key, region: "us-east-1", service: "s3" }, { method: "PUT", url: `${endpoint}/${name}`, payloadHash: EMPTY_SHA256, now: new Date() });

  objectStoreContract("opendal s3 (SeaweedFS)", fresh);

  it("signs a read link that the server serves", async () => {
    const store = await fresh();
    await store.put("doc/a.txt", new TextEncoder().encode("hello"), { contentType: "text/plain" });
    const link = await store.signedUrl("doc/a.txt", 60);
    expect(await (await fetch(link!)).text()).toBe("hello");
  });

  it("wrong keys are a provider failure, never a silent null", async () => {
    const store = await opendalStore({ service: "s3", options: { bucket: "kz-1", region: "us-east-1", endpoint, access_key_id: "x", secret_access_key: "y" }, allowLocal: true });
    await expect(store.put("a/b.txt", new Uint8Array([1]), { contentType: "text/plain" })).rejects.toMatchObject({ code: "STORAGE_PROVIDER_FAILED" });
  });
});
