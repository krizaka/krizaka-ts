import { describe, expect, it } from "vitest";

import { apps, findCodeNames, org } from "../src";

/** Every https URL in a value, with where it sits. */
function urls(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return value.startsWith("https://") ? [[path, value]] : [];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => urls(v, path ? `${path}.${k}` : k));
  return [];
}

/**
 * The shape of every URL of the org JSON, read from the data: no request leaves the unit suite (krizaka-internal#3669). Whether
 * they still answer is the daily watch `.github/workflows/org-urls.yml` (`scripts/org-urls-watch.mjs`), never a gate on a push.
 */
const OURS = [
  /(^|\.)krizaka\.com$/,
  /^krizaka-assets\.b-cdn\.net$/,
  /(^|\.)(verikora|folioviv|sovkora|kridoc)\.(com|app|shop)$/,
];
const SOCIAL = "links."; // the company's accounts on other platforms: not ours to shape-check by host
const all = [...urls(org), ...urls(apps)];

describe("every URL of the org JSON has the right shape", () => {
  it("has URLs to look at", () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it("is https, on a host of ours (or the company's GitHub), and carries no code name", () => {
    const bad: string[] = [];
    for (const [path, value] of all) {
      if (path.startsWith(SOCIAL)) continue;
      const url = new URL(value);
      const ours =
        OURS.some((re) => re.test(url.hostname)) ||
        (url.hostname === "github.com" && url.pathname.startsWith("/krizaka"));
      if (url.protocol !== "https:" || !ours) bad.push(`${path}: not ours ${value}`);
      const names = findCodeNames(value);
      if (names.length) bad.push(`${path}: code name ${names.map((n) => n.word).join(", ")} in ${value}`);
    }
    expect(bad).toEqual([]);
  });
});
