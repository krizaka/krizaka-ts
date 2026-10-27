// The audit over a route list: every route × viewport width × theme, in a real browser, the problems in words.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { auditPage, problemsOf } from "./page-audit.mjs";
import { auditContext, loadSettled, resizeSettled } from "./settle.mjs";

export const WIDTHS = [360, 390, 430, 768, 1024, 1440];
export const THEMES = ["dark", "light"];

/** A blocked third-party resource is not a page error; a script error and a hydration mismatch are. */
export const isPageError = (message) => message.type() === "error" && !/Failed to load resource/.test(message.text());

async function chromiumOf(launch) {
  if (launch) return launch();
  const { chromium } = await import("playwright-core");
  return chromium.launch();
}

/** Persists the theme the way the apps do, before any page script runs. */
function rememberTheme([key, value]) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the colour scheme is still emulated
  }
}

/** The page's console errors and uncaught exceptions, read and cleared by `take()`. */
function collectErrors(page) {
  let errors = [];
  page.on("console", (m) => {
    if (isPageError(m)) errors.push(m.text().slice(0, 140));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  return {
    take() {
      const seen = errors;
      errors = [];
      return seen;
    },
  };
}

/** One route at one width: load, settle, measure, screenshot. */
async function measure(page, { base, route, width, height, settleMs, prepare, checks, errors, where, shots }) {
  await resizeSettled(page, { width, height });
  // « load » and the faces, not « networkidle »: router prefetches can keep the page from ever going idle.
  await loadSettled(page, `${base}${route}`);
  if (prepare) await prepare(page, route);
  if (settleMs) await page.waitForTimeout(settleMs);
  const result = await page.evaluate(auditPage);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${where.replace(/[/?=&@ ]/g, "_")}.png`) });
  }
  return problemsOf(where, result, { ...checks, errors: errors.take() });
}

/**
 * @param {object} o
 * @param {string} o.base  origin of the running app
 * @param {string[]} o.routes  paths to audit
 * @param {number[]} [o.widths]  viewport widths (default 360 to 1440)
 * @param {string[]} [o.themes]  "dark" | "light" (default both): emulated colour scheme and, when `themeKey` is set, localStorage
 * @param {number} [o.height]  viewport height (default 900)
 * @param {string} [o.themeKey]  localStorage key the app persists its theme in (default "kz-theme")
 * @param {string} [o.shots]  directory for one screenshot per route × width × theme
 * @param {number} [o.settleMs]  pause after load, for late layout (default 300)
 * @param {object} [o.checks]  options of `problemsOf` (h1, headerAction, fileLabels)
 * @param {(page: object, route: string) => Promise<void>} [o.prepare]  before each route is measured (sign in, seed)
 * @param {() => Promise<object>} [o.launch]  returns a Playwright browser (default: chromium of playwright-core)
 * @returns {Promise<string[]>} the problems, empty when the pages are fine
 */
export async function auditRoutes({ base, routes, widths = WIDTHS, themes = THEMES, height = 900, themeKey = "kz-theme", shots, settleMs = 300, checks = {}, prepare, launch }) {
  const browser = await chromiumOf(launch);
  const problems = [];
  try {
    for (const theme of themes) {
      const context = await auditContext(browser, { colorScheme: theme });
      if (themeKey) await context.addInitScript(rememberTheme, [themeKey, theme]);
      const page = await context.newPage();
      const errors = collectErrors(page);
      for (const route of routes) {
        for (const width of widths) {
          const where = `${route} @${width} ${theme}`;
          problems.push(...(await measure(page, { base, route, width, height, settleMs, prepare, checks, errors, where, shots })));
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return problems;
}
