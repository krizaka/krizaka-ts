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
      if (themeKey) {
        await context.addInitScript(([key, value]) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            // storage blocked: the colour scheme is still emulated
          }
        }, [themeKey, theme]);
      }
      const page = await context.newPage();
      let errors = [];
      page.on("console", (m) => {
        if (isPageError(m)) errors.push(m.text().slice(0, 140));
      });
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
      for (const route of routes) {
        for (const width of widths) {
          await resizeSettled(page, { width, height });
          // « load » and the faces, not « networkidle »: router prefetches can keep the page from ever going idle.
          await loadSettled(page, `${base}${route}`);
          if (prepare) await prepare(page, route);
          if (settleMs) await page.waitForTimeout(settleMs);
          const result = await page.evaluate(auditPage);
          problems.push(...problemsOf(`${route} @${width} ${theme}`, result, { ...checks, errors }));
          errors = [];
          if (shots) {
            mkdirSync(shots, { recursive: true });
            await page.screenshot({ path: join(shots, `${route.replace(/[/?=&]/g, "_") || "_"}-${width}-${theme}.png`) });
          }
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return problems;
}
