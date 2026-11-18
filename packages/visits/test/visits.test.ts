import { describe, expect, it } from "vitest";

import {
  DEFAULT_DAILY_ROW_CAP,
  isBot,
  normalisePath,
  recordVisit,
  referrerDomain,
  utmValue,
  type VisitRow,
  visitRowOf,
  type VisitStore,
} from "../src";

const NOW = new Date("2026-11-17T23:59:59.000Z");
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

describe("normalisePath", () => {
  it("keeps the path, drops query and fragment, lowercases and trims the slash", () => {
    expect(normalisePath("/FR/Story/?email=a@b.c#x")).toBe("/fr/story");
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("/?utm=1")).toBe("/");
    expect(normalisePath("/a//b")).toBe("/a/b");
  });
  it("refuses what is not a page", () => {
    for (const p of [
      "/api/contact",
      "/_next/static/x.js",
      "/favicon.svg",
      "/robots.txt",
      "//evil.com",
      "x",
      "",
      null,
      undefined,
      "/%E0%A4%A",
      "/a/b/c/d/e/f",
      `/${"a".repeat(250)}`,
      "/.well-known/x",
      "/a b",
    ]) {
      expect(normalisePath(p)).toBeNull();
    }
  });
});

describe("referrerDomain", () => {
  it("keeps the domain only", () => {
    expect(referrerDomain("https://www.Google.com:8443/search?q=my+name#x")).toBe("google.com");
    expect(referrerDomain("https://news.ycombinator.com/item?id=1")).toBe("news.ycombinator.com");
  });
  it("is empty for none, garbage, other schemes and the site itself", () => {
    expect(referrerDomain(undefined)).toBe("");
    expect(referrerDomain("not a url")).toBe("");
    expect(referrerDomain("android-app://com.google.android")).toBe("");
    expect(referrerDomain("https://www.krizaka.com/fr", ["krizaka.com"])).toBe("");
  });
});

describe("utmValue", () => {
  it("keeps a short lower-case tag", () => {
    expect(utmValue("LinkedIn")).toBe("linkedin");
    expect(utmValue("x_2026-11.a")).toBe("x_2026-11.a");
    expect(utmValue("a".repeat(64))).toBe("a".repeat(64));
  });
  it("is empty for none, too long, or outside [a-z0-9_.-]: it is rejected, never truncated", () => {
    for (const v of [
      undefined,
      null,
      "",
      "a".repeat(65),
      "a b",
      "a@b.c",
      "https://x.com/?e=a@b.c",
      "é",
      "a/b",
      "a;b",
      "a=1",
    ]) {
      expect(utmValue(v)).toBe("");
    }
  });
});

describe("isBot", () => {
  it("refuses known bots, tools and an empty agent, keeps browsers", () => {
    for (const ua of [
      "Googlebot/2.1",
      "GPTBot/1.0",
      "curl/8.0",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "HeadlessChrome/120",
      "",
      null,
      undefined,
      "Lighthouse",
    ]) {
      expect(isBot(ua)).toBe(true);
    }
    expect(isBot(CHROME)).toBe(false);
  });
});

describe("visitRowOf", () => {
  it("builds the row from the UTC day", () => {
    expect(
      visitRowOf({ site: "www", path: "/fr?a=1", referer: "https://duckduckgo.com/", userAgent: CHROME }, NOW),
    ).toEqual({
      site: "www",
      page: "/fr",
      day: "2026-11-17",
      referrerDomain: "duckduckgo.com",
      utmSource: "",
      utmCampaign: "",
    });
  });
  it("keeps utm_source and utm_campaign in the row, lower-cased", () => {
    const row = visitRowOf(
      { site: "www", path: "/fr", userAgent: CHROME, utmSource: "LinkedIn", utmCampaign: "Post_2026-11.Launch" },
      NOW,
    )!;
    expect(row.utmSource).toBe("linkedin");
    expect(row.utmCampaign).toBe("post_2026-11.launch");
  });
  it("two campaigns are two keys", () => {
    const a = visitRowOf({ site: "www", path: "/", userAgent: CHROME, utmCampaign: "a" }, NOW)!;
    const b = visitRowOf({ site: "www", path: "/", userAgent: CHROME, utmCampaign: "b" }, NOW)!;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
  it("stores nothing personal: the row has exactly six keys, none holding the agent, the query or the full referrer", () => {
    const row = visitRowOf(
      { site: "www", path: "/fr?token=SECRET", referer: "https://x.com/u/secret?q=1", userAgent: CHROME },
      NOW,
    )!;
    expect(Object.keys(row).sort()).toEqual(["day", "page", "referrerDomain", "site", "utmCampaign", "utmSource"]);
    expect(JSON.stringify(row)).not.toMatch(/SECRET|Mozilla|secret|q=1/);
  });
  it("is null for a bot or a non-page", () => {
    expect(visitRowOf({ site: "www", path: "/", userAgent: "Googlebot" }, NOW)).toBeNull();
    expect(visitRowOf({ site: "www", path: "/api/x", userAgent: CHROME }, NOW)).toBeNull();
  });
});

describe("recordVisit", () => {
  const memory = () => {
    const keys = new Map<string, number>();
    const store: VisitStore = {
      async count(row: VisitRow, cap) {
        const key = JSON.stringify(row);
        const rowsToday = [...keys.keys()].filter((k) => (JSON.parse(k) as VisitRow).day === row.day).length;
        if (!keys.has(key) && rowsToday >= cap) return false;
        keys.set(key, (keys.get(key) ?? 0) + 1);
        return true;
      },
    };
    return { keys, store };
  };

  it("counts a visit and increments the same key", async () => {
    const { keys, store } = memory();
    const input = { site: "www", path: "/fr", userAgent: CHROME };
    expect(await recordVisit(store, input, NOW)).toBe(true);
    await recordVisit(store, input, NOW);
    expect([...keys.values()]).toEqual([2]);
  });

  it("counts nothing for a bot", async () => {
    const { keys, store } = memory();
    expect(await recordVisit(store, { site: "www", path: "/", userAgent: "ClaudeBot" }, NOW)).toBe(false);
    expect(keys.size).toBe(0);
  });

  it("holds the daily cap: new keys are dropped past it, known keys still count", async () => {
    const { keys, store } = memory();
    const visit = (page: string) =>
      recordVisit(store, { site: "www", path: page, userAgent: CHROME }, NOW, { dailyRowCap: 3 });
    expect(await visit("/a")).toBe(true);
    expect(await visit("/b")).toBe(true);
    expect(await visit("/c")).toBe(true);
    expect(await visit("/d")).toBe(false);
    expect(await visit("/a")).toBe(true);
    expect(keys.size).toBe(3);
  });

  it("fails closed: a store error never throws and is reported", async () => {
    const failing: VisitStore = { count: () => Promise.reject(new Error("db down")) };
    const seen: unknown[] = [];
    await expect(
      recordVisit(failing, { site: "www", path: "/", userAgent: CHROME }, NOW, { onError: (e) => seen.push(e) }),
    ).resolves.toBe(false);
    expect(seen).toHaveLength(1);
  });

  it("passes the default cap", async () => {
    let cap = 0;
    await recordVisit(
      { count: async (_r, c) => ((cap = c), true) },
      { site: "www", path: "/", userAgent: CHROME },
      NOW,
    );
    expect(cap).toBe(DEFAULT_DAILY_ROW_CAP);
  });
});
