import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsonLd } from "../lib/json-ld.ts";

test("a closing script tag in a value cannot leave the JSON-LD block", () => {
  const value = { headline: "</script><img src=x onerror=alert(1)>", note: "a & b" };
  const out = jsonLd(value);
  assert.ok(!out.includes("<") && !out.includes(">") && !out.includes("&"));
  assert.deepEqual(JSON.parse(out), value);
});

test("DocPage injects JSON-LD through jsonLd, never a raw JSON.stringify", () => {
  const page = readFileSync(new URL("../app/components/DocPage.tsx", import.meta.url), "utf8");
  assert.ok(!/__html:\s*JSON\.stringify/.test(page));
  assert.ok(page.includes("jsonLd("));
});
