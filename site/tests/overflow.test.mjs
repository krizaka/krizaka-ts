import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGES, THEMES, WIDTHS } from "../scripts/check-overflow.mjs";

/* The overflow check runs in CI against the built site (.github/workflows/site.yml). This guards the check itself: it must
   keep covering the phone-first range, the home in both languages and both themes, and CI must keep running it. */
test("the check covers 360 to 1440 px, both themes, and the home in both languages", () => {
  assert.ok(WIDTHS.includes(360) && WIDTHS.includes(390) && WIDTHS.includes(1440));
  assert.deepEqual([...THEMES].sort(), ["dark", "light"]);
  assert.ok(PAGES.includes("/") && PAGES.includes("/fr/"));
});

test("CI builds the site, then runs the overflow check on it", () => {
  const ci = readFileSync(new URL("../../.github/workflows/site.yml", import.meta.url), "utf8");
  assert.ok(ci.indexOf("npm run build") < ci.indexOf("scripts/check-overflow.mjs"));
  assert.match(ci, /for p in start auth/);
});
