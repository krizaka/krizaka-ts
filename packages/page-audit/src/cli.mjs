#!/usr/bin/env node
// krizaka-page-audit --base http://localhost:3000 --routes /en,/fr [--widths 360,390,1440] [--themes dark,light]
//                    [--theme-key kz-theme] [--h1] [--shots dir]     |     krizaka-page-audit --self-test
import { auditRoutes, THEMES, WIDTHS } from "./run.mjs";
import { selfTest } from "./self-test.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const list = (value, fallback) => (value ? value.split(",").filter(Boolean) : fallback);

if (process.argv.includes("--self-test")) {
  const failures = await selfTest();
  if (failures.length) {
    console.error(`page-audit self-test failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("page-audit self-test: 4 broken layouts seen, the fine ones clean");
} else {
  const routes = list(arg("routes"), ["/"]);
  const widths = list(arg("widths"), WIDTHS).map(Number);
  const themes = list(arg("themes"), THEMES);
  const problems = await auditRoutes({ base: arg("base", "http://localhost:3000"), routes, widths, themes, themeKey: arg("theme-key", "kz-theme"), shots: arg("shots"), checks: { h1: process.argv.includes("--h1") } });
  if (problems.length) {
    console.error(`${problems.length} page problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`no page problem: ${routes.length} routes x ${widths.length} widths x ${themes.length} themes`);
}
