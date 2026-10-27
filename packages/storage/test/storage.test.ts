import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { assertKey, bucketStore, checkEndpoint, createStorage, defineLayout, type FetchLike, folderStore, hashedName, memoryObjectStore, remoteStore, sniffType, STORAGE_CODE,trimSlashes } from "../src/node";
import { EMPTY_SHA256, presignGet, signRequest } from "../src/request-signing";
import { limitsOf, readStorageSettings, storageSettings, storeFromSettings } from "../src/settings";
import { objectStoreContract } from "../src/testkit";

const clock = { now: () => new Date("2026-10-26T12:00:00Z") };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

/** A fake Bunny-style zone: PUT / GET / DELETE on /zone/..., a directory listed as JSON when its path ends with a slash. */
function fakeZone() {
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers });
    const path = decodeURIComponent(new URL(url).pathname);
    const reply = (status: number, body: Uint8Array | string = "", headers: Record<string, string> = {}) => ({ ok: status < 300, status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body) : body).slice().buffer as ArrayBuffer, text: async () => (typeof body === "string" ? body : new TextDecoder().decode(body)) });
    if (init.headers.AccessKey !== "zone-password") return reply(401);
    if (init.method === "PUT") return (files.set(path, { bytes: init.body ?? new Uint8Array(), type: init.headers["content-type"] ?? "" }), reply(201));
    if (init.method === "DELETE") return reply(files.delete(path) ? 200 : 404);
    if (path.endsWith("/")) {
      const entries = new Map<string, { ObjectName: string; IsDirectory: boolean; Length: number }>();
      for (const [p, f] of files) {
        if (!p.startsWith(path)) continue;
        const rest = p.slice(path.length);
        const [head, ...tail] = rest.split("/");
        entries.set(head!, tail.length > 0 ? { ObjectName: head!, IsDirectory: true, Length: 0 } : { ObjectName: head!, IsDirectory: false, Length: f.bytes.byteLength });
      }
      return reply(200, JSON.stringify([...entries.values()]));
    }
    const f = files.get(path);
    return f ? reply(200, f.bytes, { "content-type": f.type }) : reply(404);
  };
  return { fetch, calls };
}

/** A fake S3 bucket: path-style PUT / GET / HEAD / DELETE, and ListObjectsV2 as XML, 2 keys a page. */
function fakeBucket() {
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const reply = (status: number, body: Uint8Array | string = "", headers: Record<string, string> = {}) => ({ ok: status < 300, status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body) : body).slice().buffer as ArrayBuffer, text: async () => (typeof body === "string" ? body : new TextDecoder().decode(body)) });
    if (!init.headers.authorization?.startsWith("AWS4-HMAC-SHA256 Credential=AKID/")) return reply(403);
    if (u.searchParams.get("list-type") === "2") {
      const prefix = `/bucket/${u.searchParams.get("prefix") ?? ""}`;
      const keys = [...files.keys()].filter((p) => p.startsWith(prefix)).sort();
      const from = Number(u.searchParams.get("continuation-token") ?? 0);
      const page = keys.slice(from, from + 2);
      const more = from + 2 < keys.length;
      const body = `<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + 2}</NextContinuationToken>` : ""}${page.map((p) => `<Contents><Key>${p.slice("/bucket/".length).replaceAll("&", "&amp;")}</Key><Size>${files.get(p)!.bytes.byteLength}</Size></Contents>`).join("")}</ListBucketResult>`;
      return reply(200, body);
    }
    if (init.method === "PUT") return (files.set(path, { bytes: init.body ?? new Uint8Array(), type: init.headers["content-type"] ?? "" }), reply(200));
    if (init.method === "DELETE") return (files.delete(path), reply(204));
    const f = files.get(path);
    if (!f) return reply(404);
    return init.method === "HEAD" ? reply(200, "", { "content-length": String(f.bytes.byteLength) }) : reply(200, f.bytes, { "content-type": f.type });
  };
  return { fetch };
}

objectStoreContract("memory", () => memoryObjectStore());
objectStoreContract("http", () => remoteStore({ endpoint: "storage.example.com", zone: "zone", accessKey: "zone-password", prefix: "krizaka", fetch: fakeZone().fetch, clock }));
objectStoreContract("s3", () => bucketStore({ endpoint: "https://s3.example.com", region: "tor1", bucket: "bucket", accessKeyId: "AKID", secretAccessKey: "sk", prefix: "krizaka", fetch: fakeBucket().fetch, clock }));

const roots: string[] = [];
objectStoreContract("folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "kz-storage-"));
  roots.push(root);
  return folderStore({ root });
});
afterAll(async () => void (await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })))));

describe("the http store", () => {
  it("sends the zone password, keeps everything under its prefix and never signs without a token key", async () => {
    const zone = fakeZone();
    const store = remoteStore({ endpoint: "storage.example.com", zone: "z", accessKey: "zone-password", prefix: "p", pullHostname: "cdn.example.com", fetch: zone.fetch, clock });
    await store.put("a/b.txt", PNG, { contentType: "image/png" });
    expect(zone.calls[0]).toMatchObject({ method: "PUT", url: "https://storage.example.com/z/p/a/b.txt" });
    expect(store.publicUrl("a/b.txt")).toBe("https://cdn.example.com/p/a/b.txt");
    expect(await store.signedUrl("a/b.txt", 60)).toBeNull();
  });
  it("signs a link the way a token-authenticated pull zone expects: sha256(key + path + expires), base64url", async () => {
    const store = remoteStore({ endpoint: "e", zone: "z", accessKey: "k", prefix: "p", pullHostname: "cdn.example.com", tokenKey: "tk", fetch: fakeZone().fetch, clock });
    const url = new URL((await store.signedUrl("a/b.txt", 300))!);
    const expires = Math.floor(clock.now().valueOf() / 1000) + 300;
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(`tk/p/a/b.txt${expires}`).digest("base64url");
    expect(url.pathname).toBe("/p/a/b.txt");
    expect(url.searchParams.get("expires")).toBe(String(expires));
    expect(url.searchParams.get("token")).toBe(expected);
  });
  it("throws a provider error on a refusal, with the status and no key in the message", async () => {
    const store = remoteStore({ endpoint: "e", zone: "z", accessKey: "wrong", fetch: fakeZone().fetch, clock });
    await expect(store.put("a.txt", PNG, { contentType: "x" })).rejects.toMatchObject({ code: STORAGE_CODE.provider, message: expect.not.stringContaining("wrong") });
  });
});

describe("Signature V4, against AWS's published test vectors", () => {
  it("get-vanilla (header signing)", () => {
    const h = signRequest(
      { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "service" },
      { method: "GET", url: "https://example.amazonaws.com/", payloadHash: EMPTY_SHA256, now: new Date("2015-08-30T12:36:00Z") },
    );
    expect(h.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });
  it("the S3 presigned GET example (query-string signing)", () => {
    const url = presignGet(
      { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "s3" },
      "https://examplebucket.s3.amazonaws.com/test.txt",
      86400,
      new Date("2013-05-24T00:00:00Z"),
    );
    expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
  it("the bucket store presigns its own links", async () => {
    const store = bucketStore({ endpoint: "https://s3.example.com", region: "tor1", bucket: "b", accessKeyId: "AKID", secretAccessKey: "sk", fetch: fakeBucket().fetch, clock });
    const url = new URL((await store.signedUrl("a/b c.txt", 120))!);
    expect(url.pathname).toBe("/b/a/b%20c.txt");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(store.publicUrl("a.txt")).toBeNull();
  });
});

describe("the rules", () => {
  it("names a file by its content: name.<sha10>.ext", () => {
    expect(hashedName("photo.jpg", JPEG)).toMatch(/^photo\.[0-9a-f]{10}\.jpg$/);
    expect(hashedName("photo.jpg", JPEG)).toBe(hashedName("photo.jpg", JPEG));
    expect(hashedName("noext", JPEG)).toMatch(/^noext\.[0-9a-f]{10}$/);
  });
  it("sniffs the bytes, not the name", () => {
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(JPEG)).toBe("image/jpeg");
    expect(sniffType(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffType(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffType(new TextEncoder().encode("<html><svg>"))).toBeNull();
    expect(sniffType(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe("video/mp4");
    expect(sniffType(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
  it("accepts good keys and refuses bad ones", () => {
    expect(assertKey("site/home/photo.1a2b3c4d5e.jpg")).toBe("site/home/photo.1a2b3c4d5e.jpg");
    expect(() => assertKey("a/./b")).toThrow(/\. or \.\./);
    expect(() => assertKey("a/%2e%2e/b")).toThrow(/character/);
  });
  it("refuses an endpoint that reaches inside our network", () => {
    expect(checkEndpoint("https://tor1.digitaloceanspaces.com/")).toBe("https://tor1.digitaloceanspaces.com");
    for (const bad of ["http://s3.example.com", "https://localhost:9000", "https://127.0.0.1", "https://10.0.0.5", "https://169.254.169.254", "https://192.168.1.2", "https://u:p@s3.example.com", "https://[::1]", "not a url", "https://db.internal"]) expect(() => checkEndpoint(bad)).toThrow(expect.objectContaining({ code: STORAGE_CODE.badEndpoint }));
    expect(checkEndpoint("http://localhost:9000", { allowLocal: true })).toBe("http://localhost:9000");
  });
});

describe("createStorage", () => {
  const layout = defineLayout(["site/home/", "people/"]);
  const make = (maxBytes = 100) => {
    const store = memoryObjectStore({ publicBaseUrl: "https://cdn.example.com" });
    return { store, storage: createStorage({ store, layout, limits: { maxBytes, signedUrlSeconds: 60 } }) };
  };
  it("stores under a content-hashed name inside a declared prefix and answers its link", async () => {
    const { storage, store } = make();
    const out = await storage.upload({ prefix: "site/home/", name: "hero.png", bytes: PNG, allow: ["image/png"], declaredType: "image/png" });
    expect(out.key).toMatch(/^site\/home\/hero\.[0-9a-f]{10}\.png$/);
    expect(out).toMatchObject({ contentType: "image/png", size: PNG.byteLength, url: `https://cdn.example.com/${out.key}` });
    expect(await store.head(out.key)).not.toBeNull();
  });
  it("refuses an unknown prefix, a file too big, an empty one, a type not allowed, and a declared type the bytes contradict", async () => {
    const { storage } = make(20);
    const base = { name: "a.png", bytes: PNG, allow: ["image/png"] };
    await expect(storage.upload({ ...base, prefix: "secret/" })).rejects.toMatchObject({ code: STORAGE_CODE.badPrefix });
    await expect(storage.upload({ ...base, prefix: "people/", bytes: new Uint8Array(21) })).rejects.toMatchObject({ code: STORAGE_CODE.tooBig });
    await expect(storage.upload({ ...base, prefix: "people/", bytes: new Uint8Array(0) })).rejects.toMatchObject({ code: STORAGE_CODE.tooBig });
    await expect(storage.upload({ ...base, prefix: "people/", allow: ["image/jpeg"] })).rejects.toMatchObject({ code: STORAGE_CODE.badType });
    await expect(storage.upload({ ...base, prefix: "people/", declaredType: "image/jpeg" })).rejects.toMatchObject({ code: STORAGE_CODE.typeMismatch });
  });
  it("refuses bytes that lie about their name: a script called .png", async () => {
    const { storage } = make();
    await expect(storage.upload({ prefix: "people/", name: "x.png", bytes: new TextEncoder().encode("<script>alert(1)</script>"), allow: ["image/png"] })).rejects.toMatchObject({ code: STORAGE_CODE.badType });
  });
  it("falls back to a signed link when the zone is private, and to null when it cannot sign", async () => {
    const zone = remoteStore({ endpoint: "e", zone: "z", accessKey: "k", pullHostname: "", tokenKey: "t", fetch: fakeZone().fetch, clock });
    expect(await createStorage({ store: zone, layout, limits: { maxBytes: 9, signedUrlSeconds: 60 } }).urlFor("people/a.png")).toBeNull();
    const bucket = bucketStore({ endpoint: "https://s3.example.com", region: "r", bucket: "b", accessKeyId: "AKID", secretAccessKey: "s", fetch: fakeBucket().fetch, clock });
    expect(await createStorage({ store: bucket, layout, limits: { maxBytes: 9, signedUrlSeconds: 77 } }).urlFor("people/a.png")).toContain("X-Amz-Expires=77");
  });
  it("reads the limits at each call: the admin's change applies at once", async () => {
    let max = 5;
    const store = memoryObjectStore();
    const storage = createStorage({ store, layout, limits: () => ({ maxBytes: max, signedUrlSeconds: 60 }) });
    const input = { prefix: "people/", name: "a.png", bytes: PNG, allow: ["image/png"] };
    await expect(storage.upload(input)).rejects.toMatchObject({ code: STORAGE_CODE.tooBig });
    max = 1000;
    await expect(storage.upload(input)).resolves.toBeDefined();
  });
  it("a layout prefix needs its trailing slash", () => {
    expect(() => defineLayout(["site"])).toThrow(/slash/);
  });
});

describe("the settings fragment: the admin chooses the provider", () => {
  const deps = { fetch: fakeZone().fetch, clock };
  const base = { provider: "local" as const, maxMegabytes: 25, signedUrlSeconds: 300, endpoint: "", region: "", bucket: "", zone: "", prefix: "", pullHostname: "", publicBaseUrl: "" };
  it("declares the provider and its coordinates, no key", () => {
    expect(Object.keys(storageSettings)).toEqual(expect.arrayContaining(["storage.provider", "storage.maxMegabytes", "storage.endpoint", "storage.bucket"]));
    expect(Object.keys(storageSettings).some((k) => /key|secret|password/i.test(k))).toBe(false);
  });
  it("reads the settings with defaults, and turns megabytes into bytes", async () => {
    const s = await readStorageSettings((k) => ({ "storage.provider": "s3", "storage.maxMegabytes": 2 })[k as string]);
    expect(s).toMatchObject({ provider: "s3", maxMegabytes: 2, signedUrlSeconds: 300, endpoint: "" });
    expect(limitsOf(s).maxBytes).toBe(2 * 1024 * 1024);
    expect((await readStorageSettings(() => "nonsense")).provider).toBe("local");
  });
  it("builds the chosen store, and refuses a chosen provider without what it needs", async () => {
    await expect(Promise.resolve().then(() => storeFromSettings(base, {}, deps))).rejects.toMatchObject({ code: STORAGE_CODE.badConfig });
    expect(() => storeFromSettings({ ...base, provider: "http", endpoint: "storage.example.com", zone: "z" }, {}, deps)).toThrow(/password/);
    expect(() => storeFromSettings({ ...base, provider: "http", endpoint: "https://storage.example.com", zone: "z" }, { accessKey: "k" }, deps)).toThrow(/host name only/);
    expect(storeFromSettings({ ...base, provider: "http", endpoint: "storage.example.com", zone: "z", pullHostname: "cdn.example.com" }, { accessKey: "k" }, deps).publicUrl("a/b.png")).toBe("https://cdn.example.com/a/b.png");
    const s3 = { ...base, provider: "s3" as const, endpoint: "https://tor1.digitaloceanspaces.com", region: "tor1", bucket: "b" };
    expect(() => storeFromSettings(s3, { accessKeyId: "a" }, deps)).toThrow(/secret/);
    expect(storeFromSettings(s3, { accessKeyId: "a", secretAccessKey: "s" }, deps).publicUrl("a.png")).toBeNull();
    expect(() => storeFromSettings({ ...s3, endpoint: "https://10.0.0.1" }, { accessKeyId: "a", secretAccessKey: "s" }, deps)).toThrow(expect.objectContaining({ code: STORAGE_CODE.badEndpoint }));
    expect(storeFromSettings({ ...base, root: undefined } as never, { root: "/tmp/kz" }, deps)).toBeDefined();
  });
});

describe("trimSlashes", () => {
  it("trims slashes at the ends without a regular expression, even a very long run", () => {
    expect(trimSlashes("//a/b//")).toBe("a/b");
    expect(trimSlashes("https://cdn.example.com///", "end")).toBe("https://cdn.example.com");
    expect(trimSlashes("/".repeat(200_000))).toBe("");
  });
});
