import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HERO_WIDTHS } from "../scripts/check-hero.mjs";
import { PAGES, WIDTHS } from "../scripts/check-overflow.mjs";

/* The hero check runs in CI against the built site, through the overflow check. This guards the check and the home's source. */
test("the hero is measured at phone and desktop widths, on the home in both languages", () => {
  assert.ok(HERO_WIDTHS.includes(360) && HERO_WIDTHS.includes(1440));
  for (const width of HERO_WIDTHS) assert.ok(WIDTHS.includes(width));
  assert.ok(PAGES.includes("/") && PAGES.includes("/fr/"));
});

test("the overflow check runs the hero check", () => {
  const overflow = readFileSync(new URL("../scripts/check-overflow.mjs", import.meta.url), "utf8");
  assert.match(overflow, /heroProblems\(page\)/);
});

test("the home has no figures band, and the hero's install is one package", () => {
  const home = readFileSync(new URL("../app/components/Home.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(home, /proofs=|NumberTicker|LandingPage/);
  assert.match(home, /<SpecimenTag/);
  assert.match(home, /aside=\{<InstallTabs names=\{HERO_PACKAGE\}/);
});
