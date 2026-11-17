import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { bucketStore, type FetchLike, publicOnlyFetch, type Resolver } from "../src/node";
import { createProviderService, memoryProviderStore } from "../src/provider-admin";
import { NOT_PUBLIC, PUBLIC } from "./fixtures/addresses";

/**
 * A bucket someone typed is called by our server (krizaka-restricted#344): it must never make us call our own network, neither by
 * answering a redirect nor by resolving to a public address when checked and to a private one when connected.
 */

const at = { now: () => new Date("2026-11-17T12:00:00Z") };
const publicAddress = PUBLIC[0]!;
const privateAddress = NOT_PUBLIC.find(([range]) => range.startsWith("link-local"))![1];

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** A local HTTP server that counts the requests it receives. */
async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("a bucket that answers a redirect", () => {
  it("is refused, and the address it points at is never called", async () => {
    const reached: string[] = [];
    const inside = await listen((req, res) => {
      reached.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "text/plain" }).end("inside");
    });
    const bucket = await listen((req, res) => {
      req.resume();
      res.writeHead(302, { location: `${inside}/internal` }).end();
    });
    const store = bucketStore({
      endpoint: bucket,
      region: "tor1",
      bucket: "docs",
      accessKeyId: "id",
      secretAccessKey: "secret",
      fetch: globalThis.fetch as unknown as FetchLike,
      clock: at,
    });
    await expect(store.get("a/b.txt")).rejects.toThrow(/302/);
    await expect(store.head("a/b.txt")).rejects.toThrow(/302/);
    await expect(store.put("a/b.txt", new TextEncoder().encode("x"), { contentType: "text/plain" })).rejects.toThrow(
      /302/,
    );
    await expect(store.delete("a/b.txt")).rejects.toThrow(/302/);
    await expect(store.list("a")).rejects.toThrow(/302/);
    expect(reached).toEqual([]);
  });
});

describe("a bucket whose name resolves public when checked, private when connected", () => {
  it("is refused by the connection test, and nothing is sent to it", async () => {
    let lookups = 0;
    const rebinding: Resolver = async () => (++lookups === 1 ? [publicAddress] : [privateAddress]);
    const sent: string[] = [];
    const recording: FetchLike = async (url, init) => {
      sent.push(`${init.method} ${url}`);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "",
      };
    };
    const kek = randomBytes(32);
    let n = 0;
    const service = createProviderService({
      store: memoryProviderStore(),
      vault: { keyId: "k1", key: kek, ring: { keys: { k1: kek } } },
      clock: at,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      audit: async () => undefined,
      open: { runtime: "server", environment: "dev", fetch: recording, clock: at },
      resolve: rebinding,
      probeId: () => "probe",
      references: async () => 0,
    });
    const admin = { id: "a1", label: "Eric" };
    const created = await service.create(admin, {
      scope: "user:u1",
      kind: "s3",
      label: "My S3",
      coordinates: { endpoint: "https://bucket.example.com", region: "tor1", bucket: "docs" },
      credentials: { accessKeyId: "id", secretAccessKey: "secret" },
    });
    const tested = await service.test(admin, created.id);
    expect(sent).toEqual([]);
    expect(tested.status).not.toBe("verified");
    expect(JSON.stringify(tested.lastTest)).toMatch(/private address/);
    expect(lookups).toBeGreaterThanOrEqual(2);
  });
});

describe("publicOnlyFetch", () => {
  /** node:http standing in for node:https, connecting to a local server, and keeping the `lookup` the request was given. */
  const throughLocal = (origin: string, seen: { lookup?: unknown }) =>
    ((url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
      seen.lookup = options.lookup;
      const local = new URL(origin);
      return http.request(
        { ...options, lookup: undefined, host: local.hostname, port: local.port, path: url.pathname + url.search },
        callback,
      );
    }) as unknown as NonNullable<Parameters<typeof publicOnlyFetch>[0]>["request"];

  it("refuses a URL that is not https", async () => {
    await expect(publicOnlyFetch()("http://bucket.example.com/x", { method: "GET", headers: {} })).rejects.toThrow(
      /https/,
    );
  });

  it("refuses a name that resolves to a private address, before any connection", async () => {
    const call = publicOnlyFetch({ resolve: async () => [privateAddress] });
    await expect(call("https://bucket.example.com/x", { method: "GET", headers: {} })).rejects.toThrow(
      /private address/,
    );
  });

  it("refuses a name when any one of its addresses is private", async () => {
    const call = publicOnlyFetch({ resolve: async () => [publicAddress, privateAddress] });
    await expect(call("https://bucket.example.com/x", { method: "GET", headers: {} })).rejects.toThrow(
      /private address/,
    );
  });

  it("refuses a name that does not resolve, or that the resolver cannot answer", async () => {
    for (const resolve of [async () => [], () => Promise.reject(new Error("ENOTFOUND"))] satisfies Resolver[])
      await expect(
        publicOnlyFetch({ resolve })("https://bucket.example.com/x", { method: "GET", headers: {} }),
      ).rejects.toThrow(/does not resolve/);
  });

  it("refuses a URL that is a private address literal", async () => {
    await expect(publicOnlyFetch()(`https://${privateAddress}/x`, { method: "GET", headers: {} })).rejects.toThrow(
      /private address/,
    );
  });

  it("answers the status, headers and body, never follows a redirect, and connects through the checked lookup", async () => {
    const reached: string[] = [];
    const origin = await listen((req, res) => {
      reached.push(`${req.method} ${req.url}`);
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        if (req.url === "/moved") return void res.writeHead(302, { location: "/elsewhere" }).end();
        res.setHeader("set-cookie", ["a=1", "b=2"]);
        res.writeHead(200, { "content-type": "text/plain", "x-echo": req.headers["x-echo"] ?? "" }).end(`got ${body}`);
      });
    });
    const seen: { lookup?: unknown } = {};
    const call = publicOnlyFetch({ resolve: async () => [publicAddress], request: throughLocal(origin, seen) });

    const ok = await call("https://bucket.example.com/a?b=1", {
      method: "PUT",
      headers: { "x-echo": "yes" },
      body: new TextEncoder().encode("bytes"),
    });
    expect([ok.ok, ok.status, ok.headers.get("x-echo"), await ok.text()]).toEqual([true, 200, "yes", "got bytes"]);
    expect([ok.headers.get("Set-Cookie"), ok.headers.get("x-absent")]).toEqual(["a=1, b=2", null]);
    expect(new TextDecoder().decode(await ok.arrayBuffer())).toBe("got bytes");

    const moved = await call("https://bucket.example.com/moved", { method: "GET", headers: {} });
    expect([moved.ok, moved.status]).toEqual([false, 302]);
    expect(reached).toEqual(["PUT /a?b=1", "GET /moved"]);

    // The lookup handed to the connection is the checked one: a private answer is an error, a public one goes through.
    type Lookup = (host: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void;
    const answer = (o: object) =>
      new Promise((done) => (seen.lookup as Lookup)("bucket.example.com", o, (e, a) => done(e ?? a)));
    expect(await answer({ all: true })).toEqual([{ address: publicAddress, family: 4 }]);
    expect(await answer({})).toBe(publicAddress);
    const refusing = publicOnlyFetch({ resolve: async () => [privateAddress], request: throughLocal(origin, seen) });
    await refusing("https://bucket.example.com/a", { method: "GET", headers: {} }).catch(() => undefined);
    expect(String(await answer({}))).toMatch(/private address/);
  });

  it("gives up on an endpoint that does not answer in time", async () => {
    const origin = await listen(() => undefined);
    const call = publicOnlyFetch({
      resolve: async () => [publicAddress],
      timeoutMs: 50,
      request: throughLocal(origin, {}),
    });
    await expect(call("https://bucket.example.com/slow", { method: "GET", headers: {} })).rejects.toThrow(/in time/);
  });
});
