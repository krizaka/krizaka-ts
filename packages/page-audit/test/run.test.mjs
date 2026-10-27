import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, it } from "vitest";

import { auditRoutes, routesFromSitemap } from "../src/index.mjs";

const hasBrowser = await import("playwright-core").then(async (m) => { try { return !!(await m.chromium.launch().then((b) => b.close().then(() => true))); } catch { return false; } }, () => false);

const html = (main, extra = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><nav>n</nav><main>${main}</main><footer>A Krizaka product</footer>${extra}</body></html>`;
const PAGES = {
  "/ok": [200, html("<h1>Hello</h1>")],
  "/gone": [404, html("<h1>Not found</h1>")],
  "/empty": [200, html("")],
  "/bad-a11y": [200, html('<h1>Hello</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10">')],
};
let server;
let base;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/sitemap.xml") return res.end(`<urlset><url><loc>http://x/ok</loc></url><url><loc>http://x/gone</loc></url></urlset>`);
    if (url.pathname === "/api/in") return res.writeHead(204, { "set-cookie": "s=1; Path=/" }).end();
    if (url.pathname === "/app") return res.writeHead(/(^|; )s=1/.test(req.headers.cookie ?? "") ? 200 : 401, { "content-type": "text/html" }).end(html("<h1>Inside</h1>"));
    const [status, body] = PAGES[url.pathname] ?? [404, html("<h1>x</h1>")];
    res.writeHead(status, { "content-type": "text/html" }).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const audit = (o) => auditRoutes({ base, widths: [390], themes: ["dark"], settleMs: 0, ...o });

describe("a route source that is a crawl", () => {
  it("reads the sitemap, the first routes first, up to the limit; null when nothing answers", async () => {
    const fetcher = async () => ({ ok: true, text: async () => "<loc>https://a.test/b</loc><loc>https://a.test/</loc><loc>https://a.test/c</loc>" });
    assert.deepEqual(await routesFromSitemap("https://a.test", { first: ["/", "/docs"], limit: 3, fetcher }), ["/", "/docs", "/b"]);
    assert.equal(await routesFromSitemap("https://a.test", { fetcher: async () => ({ ok: false }) }), null);
    assert.equal(await routesFromSitemap("https://a.test", { fetcher: async () => Promise.reject(new Error("down")) }), null);
  });
});

describe.skipIf(!hasBrowser)("auditRoutes over a running app", () => {
  it("is clean on a fine page, with every opt-in check on", async () => {
    assert.deepEqual(await audit({ routes: ["/ok"], checks: { status: true, emptyMain: true, landmarks: "public", minAction: 36 } }), []);
  });
  it("reports the HTTP status and the empty <main>", async () => {
    const problems = await audit({ routes: ["/gone", "/empty"], checks: { status: true, emptyMain: true } });
    assert.ok(problems.some((p) => /\/gone @390 dark: HTTP 404/.test(p)), problems.join("|"));
    assert.ok(problems.some((p) => /\/empty @390 dark: empty <main>/.test(p)), problems.join("|"));
  });
  it("audits a signed-in route after signIn, with the route's own chrome, and not before", async () => {
    const signIn = async (context) => void (await context.request.post(`${base}/api/in`));
    assert.deepEqual(await audit({ routes: [{ url: "/app", session: true, chrome: "app" }], session: { signIn }, checks: { status: true } }), []);
    assert.deepEqual(await audit({ routes: [], session: { signIn, routes: async () => ["/app"] }, checks: { status: true } }), []);
    const anonymous = await audit({ routes: ["/app"], checks: { status: true } });
    assert.match(anonymous[0], /HTTP 401/);
  });
  it("keeps the axe ratchet of the repo: a new violation fails, the recorded count passes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    const empty = join(dir, "empty.json");
    writeFileSync(empty, JSON.stringify({ app: "t", rules: {} }));
    const log = () => {};
    const failing = await audit({ routes: ["/bad-a11y"], a11y: { app: "t", baseline: empty, widths: [390], log } });
    assert.ok(failing.some((p) => /image-alt/.test(p)), failing.join("|"));
    const recorded = join(dir, "recorded.json");
    writeFileSync(recorded, JSON.stringify({ app: "t", rules: { "image-alt": { impact: "critical", count: 1 } } }));
    assert.deepEqual(await audit({ routes: ["/bad-a11y"], a11y: { app: "t", baseline: recorded, widths: [390], log } }), []);
  });
});
