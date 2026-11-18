import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

/* One footer, one contentinfo: @krizaka/ui's FamilyFooter fed by footerFor("ts") of @krizaka/org, rendered once by the
   root after the page. A local footer (SiteFooter, FamilyFooterView, a hand-typed <footer>, a typed URL or social) never comes back. */
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const walk = (dir) =>
  readdirSync(new URL(`../${dir}/`, import.meta.url)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(new URL(`../${rel}`, import.meta.url)).isDirectory() ? walk(rel) : [rel];
  });

test("the root renders FamilyFooter once, from footerFor('ts'), after the page", () => {
  const root = read("app/components/SiteRoot.tsx");
  assert.equal(root.match(/<FamilyFooter\b/g)?.length, 1);
  assert.match(root, /footer=\{footerFor\("ts"\)\}/);
  assert.match(root, /current="ts"/);
  assert.match(root, /kind="developer"/);
  assert.ok(root.indexOf("{children}") < root.indexOf("<FamilyFooter"));
  assert.doesNotMatch(root, /<DocsLayout/, "the sidebar belongs to the documentation, not to the home");
});

test("no local footer: no footer component, no <footer>, no typed social", () => {
  assert.equal(existsSync(new URL("../app/components/SiteFooter.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/components/FamilyFooterView.tsx", import.meta.url)), false);
  const offenders = walk("app")
    .filter((f) => /\.tsx?$/.test(f) && !/SiteRoot\.tsx$/.test(f))
    .filter((f) =>
      /<FamilyFooter\b|<SiteFooter\b|<footer\b|linkedin\.com|instagram\.com|facebook\.com|youtube\.com/.test(read(f)),
    );
  assert.deepEqual(offenders, []);
});
