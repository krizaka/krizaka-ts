import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ts.krizaka.com in the Cahier (krizaka-ui ADR-004, #417): the faces of @krizaka/fonts 0.3 (Young Serif, Atkinson
// Hyperlegible Next, Courier Prime), and the site's own styles free of the template tells — no uppercase tracked label,
// no blur or glow, no round card.
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the Cahier faces, loaded by next/font/local", () => {
  const fonts = read("app/fonts.ts");
  for (const f of [
    "young-serif-latin-400.woff2",
    "atkinson-hyperlegible-next-latin-wght.woff2",
    "courier-prime-latin-400.woff2",
  ])
    assert.ok(fonts.includes(f), f);
  assert.doesNotMatch(
    fonts + read("app/globals.css"),
    /inter-latin|plus-jakarta|jetbrains-mono|"Plus Jakarta Sans"|"JetBrains Mono"/,
  );
});

test("no template tell in the site's own styles", () => {
  for (const f of ["app/globals.css"]) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(css, /text-transform:\s*uppercase/, `${f}: uppercase`);
    assert.doesNotMatch(css, /letter-spacing:\s*0?\.(0[4-9]|[1-9])/, `${f}: tracked caps`);
    assert.doesNotMatch(css, /blur\(|backdrop-filter|radial-gradient/, `${f}: a blur or a glow`);
    assert.doesNotMatch(css, /border-radius:\s*(1\d|[2-9]\d)px/, `${f}: a round card`);
  }
});
