#!/usr/bin/env node
// krizaka-page-audit --base http://localhost:3000 --routes /en,/fr [--widths 360,390,1440] [--themes dark,light]
//                    [--theme-key kz-theme] [--h1] [--shots dir]
//                    [--sitemap [--limit 14]] [--status] [--empty-main] [--min-action 36] [--a11y app:baseline.json]     |     krizaka-page-audit --self-test
import { auditRoutes, routesFromSitemap, THEMES, WIDTHS } from "./run.mjs";
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
  console.log("page-audit self-test: every broken layout seen, the fine ones clean");
} else {
  const base = arg("base", "http://localhost:3000");
  const has = (name) => process.argv.includes(`--${name}`);
  const routes = has("sitemap")
    ? await routesFromSitemap(base, { first: list(arg("routes"), ["/"]), limit: Number(arg("limit", 14)) })
    : list(arg("routes"), ["/"]);
  if (!routes) {
    console.error(`Nothing answers at ${base}/sitemap.xml`);
    process.exit(2);
  }
  const [app, baseline] = (arg("a11y") ?? "").split(":");
  const widths = list(arg("widths"), WIDTHS).map(Number);
  const themes = list(arg("themes"), THEMES);
  const problems = await auditRoutes({
    base,
    routes,
    widths,
    themes,
    themeKey: arg("theme-key", "kz-theme"),
    shots: arg("shots"),
    a11y: baseline ? { app, baseline } : undefined,
    checks: {
      h1: has("h1"),
      status: has("status"),
      emptyMain: has("empty-main"),
      minAction: arg("min-action") ? Number(arg("min-action")) : undefined,
    },
  });
  if (problems.length) {
    console.error(`${problems.length} page problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`no page problem: ${routes.length} routes x ${widths.length} widths x ${themes.length} themes`);
}
