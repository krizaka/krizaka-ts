import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The registries where this family really publishes (krizaka-internal#4606): Java is in our own Maven repository,
// Rust is not on crates.io, so no word of the site may claim either one.
const PUBLISHED = ["npm"];
const CLAIMS = { "Maven Central": /maven central/i, "crates.io": /crates\.io/i };

for (const locale of ["en", "fr"]) {
  test(`messages/${locale}.json names no registry that does not hold our packages`, () => {
    const text = readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8");
    for (const [name, pattern] of Object.entries(CLAIMS)) {
      assert.ok(PUBLISHED.includes(name) || !pattern.test(text), `${locale}.json says "${name}", where nothing is published`);
    }
  });
}
