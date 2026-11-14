import { describe, expect, it } from "vitest";

import { check, mapLimit, reasonOf, reportByHost, urlsOf, watched } from "./org-urls-watch.mjs";

const reset = () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }));

describe("watched", () => {
  it("keeps the https URLs, once, without the schema, the folders and the social accounts", () => {
    const doc = {
      $schema: "https://x.krizaka.com/s.json",
      base: "https://cdn.krizaka.com/folder",
      links: { social: [{ url: "https://instagram.com/k" }] },
      a: "https://www.krizaka.com/a",
      b: ["https://www.krizaka.com/a", "https://blog.krizaka.com/", "http://insecure"],
    };
    expect(urlsOf(doc).length).toBe(6);
    expect(watched(doc)).toEqual(["https://www.krizaka.com/a", "https://blog.krizaka.com/"]);
  });
});

describe("check", () => {
  it("is null for a 200", async () => {
    expect(await check("u", () => Promise.resolve(200), 0)).toBeNull();
  });
  it("retries a dropped connection once and is null when the second try answers", async () => {
    let calls = 0;
    expect(await check("u", () => (calls++ === 0 ? reset() : Promise.resolve(200)), 0)).toBeNull();
    expect(calls).toBe(2);
  });
  it("gives the reason of a connection that drops twice", async () => {
    expect(await check("u", reset, 0)).toBe("ECONNRESET");
  });
  it("retries a 502 once", async () => {
    let calls = 0;
    expect(await check("u", () => Promise.resolve(calls++ === 0 ? 502 : 200), 0)).toBeNull();
    expect(await check("u", () => Promise.resolve(502), 0)).toBe("502");
  });
  it("keeps a 404 final, without retry", async () => {
    let calls = 0;
    expect(await check("u", () => (calls++, Promise.resolve(404)), 0)).toBe("404");
    expect(calls).toBe(1);
  });
  it("does not retry a host that does not resolve", async () => {
    let calls = 0;
    const gone = () => (calls++, Promise.reject(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })));
    expect(await check("u", gone, 0)).toBe("ENOTFOUND");
    expect(calls).toBe(1);
  });
  it("reads the reason of a plain error", () => {
    expect(reasonOf(new Error("boom"))).toBe("boom");
  });
});

describe("mapLimit", () => {
  it("never runs more than the limit at once and keeps the order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});

describe("reportByHost", () => {
  it("is red with the dead URLs for a host that has some, green for the others (so its alert clears)", () => {
    const urls = ["https://a.krizaka.com/1", "https://a.krizaka.com/2", "https://b.krizaka.com/1"];
    const report = reportByHost(urls, ["404", null, null]);
    expect(report.map(({ host, state }) => [host, state])).toEqual([
      ["a.krizaka.com", "red"],
      ["b.krizaka.com", "green"],
    ]);
    expect(report[0].body).toContain("- 404 https://a.krizaka.com/1");
    expect(report[0].body).not.toContain("/2");
  });
});
