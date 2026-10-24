import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { familyLabels, siteById } from "@krizaka/ui/sites";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the bar has no family switcher and no hand-made links to other sites; the footer is ts's", () => {
  const bar = read("app/components/TopBar.tsx");
  assert.doesNotMatch(bar, /NavBar\.Family/, "no family switcher: krizaka.com is the only way back (krizaka-ui#485)");
  assert.match(bar, /<NavBar\.Repo /);
  assert.match(bar, /<NavBar\.Language /, "the family's language switch, not a hand-made button");
  assert.match(bar, /<NavBar\.MobilePreferences /);
  // at 360 px the mark, the search and the toggle fill the bar: the bar-level language switch is hidden below md (the panel has it)
  assert.match(bar, /<NavBar\.Language [^>]*className="hidden md:inline-flex"/, "the bar-level language switch is hidden on a phone");
  assert.doesNotMatch(bar, /KRIZAKA_URL|UI_URL|JAVA_URL/);
  assert.match(read("app/components/FamilyFooterView.tsx"), /current="ts"/);
});

test("the family data knows this site and both languages", () => {
  assert.equal(siteById("ts").url, "https://ts.krizaka.com");
  assert.equal(siteById("ts").repo.endsWith("krizaka-ts"), true);
  assert.ok(familyLabels.en.descriptions.ts && familyLabels.fr.descriptions.ts);
});
