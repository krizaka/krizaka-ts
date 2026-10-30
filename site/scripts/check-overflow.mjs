#!/usr/bin/env node
/* No horizontal overflow, measured in a real browser (Playwright) on the built site, at every width people read it at
   (phone 360 to desktop 1440), in both languages and both themes. A page overflows when the document is wider than the
   window, or when a visible element sticks out of it without sitting in a scroller made for that (a code block, a table).
   The home is the page that must never overflow; the documentation pages are checked too.

   Usage: node scripts/check-overflow.mjs --base http://localhost:3000 [--playwright <path>] [--shots <dir>]
   With --shots, a screenshot of the home is saved per width and theme (390 and 1440 are the ones a pull request shows). */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The widths the site is read at, from the narrowest phone to a wide desktop. */
export const WIDTHS = [360, 390, 768, 1024, 1440];
/** The pages checked: the home in both languages first, then the first guide and a package page. */
export const PAGES = ["/", "/fr/", "/start/", "/fr/start/", "/auth/", "/fr/auth/", "/api-keys/"];
export const THEMES = ["dark", "light"];

/** Runs in the page: the elements that stick out of the window's width, outside any horizontal scroller. */
function measure() {
  const width = document.documentElement.clientWidth;
  const out = [];
  if (document.documentElement.scrollWidth > width + 1)
    out.push(`the document is ${document.documentElement.scrollWidth}px wide in a ${width}px window`);
  const scrolls = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || (r.right <= width + 1 && r.left >= -1)) continue;
    const style = getComputedStyle(el);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      style.position === "fixed" ||
      style.clipPath !== "none"
    )
      continue;
    if (scrolls(el)) continue;
    out.push(
      `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""}> spans ${Math.round(r.left)}→${Math.round(r.right)} in a ${width}px window`,
    );
    if (out.length > 6) break;
  }
  return out;
}

const flagOf = (args, name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

/** One page at one width and theme: the overflows the browser measures, and a screenshot of the home pages when asked. */
async function checkPage(page, { base, path, width, theme, shots }) {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const issues = await page.evaluate(measure);
  const isHome = path === "/" || path === "/fr/";
  if (shots && isHome && (width === 390 || width === 1440)) {
    await page.screenshot({ path: `${shots}/home${path === "/" ? "" : "-fr"}-${width}-${theme}.png`, fullPage: true });
  }
  return issues.map((issue) => `${path} @${width} ${theme}: ${issue}`);
}

async function main() {
  const args = process.argv.slice(2);
  const base = flagOf(args, "--base", "http://localhost:3000").replace(/\/$/, "");
  const shots = flagOf(args, "--shots", null);
  const { chromium } = createRequire(import.meta.url)(flagOf(args, "--playwright", "playwright"));
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const problems = [];
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      await context.addInitScript((t) => localStorage.setItem("kz-theme", t), theme);
      const page = await context.newPage();
      for (const path of PAGES) problems.push(...(await checkPage(page, { base, path, width, theme, shots })));
      await context.close();
    }
  }
  await browser.close();
  if (problems.length) {
    console.error(problems.map((p) => `check-overflow: ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(
    `check-overflow: ${PAGES.length} pages × ${WIDTHS.length} widths × ${THEMES.length} themes, no horizontal overflow`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
