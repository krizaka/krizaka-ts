// Visual regression of the main journeys, one source for every app (krizaka/.github#375).
//
// What it fixes so that two runs of the same build give the same pixels: a frozen clock, reduced motion, no caret, no
// View Transition, the fonts loaded, a fixed locale and time zone, the app's theme key set before the page runs, and the
// live values masked. What it leaves to the app: its routes, how its persona signs in, what is live on its pages.
// The baselines are Linux ones, taken in the official Playwright container (the `visual-regression` workflow of
// krizaka/.github); the helper never compares against a baseline taken on a Mac.
//
//   import { test, expect } from "@playwright/test";
//   import { defineJourneyTests } from "@krizaka/page-audit/visual";
//   defineJourneyTests({ test, expect, journeys: [{ name: "landing", path: "/fr" }, …], signIn });

import { settled, withoutViewTransitions } from "./settle.mjs";

/** The two sizes of every journey: a laptop and a phone. */
export const VIEWPORTS = Object.freeze({
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
});
export const VISUAL_THEMES = Object.freeze(["light", "dark"]);
/** The clock of every capture (a Thursday, in winter: no daylight-saving edge). */
export const FROZEN_TIME = "2026-01-15T15:00:00.000Z";
export const VISUAL_LOCALE = "fr-CA";
export const VISUAL_TIME_ZONE = "America/Toronto";

/** The viewport × theme cells of a journey, with the snapshot name of each (`<journey>-<viewport>-<theme>.png`). */
export function visualMatrix(journey, { viewports = VIEWPORTS, themes = VISUAL_THEMES } = {}) {
  const only = journey.viewports ?? Object.keys(viewports);
  const cells = [];
  for (const viewport of only) {
    if (!viewports[viewport]) throw new Error(`unknown viewport « ${viewport} » in journey « ${journey.name} »`);
    for (const theme of themes) {
      const suffix = journey.firstPaint ? "-first-paint" : "";
      cells.push({ viewport, size: viewports[viewport], theme, snapshot: `${journey.name}${suffix}-${viewport}-${theme}.png` });
    }
  }
  return cells;
}

/** The options of a browser context for a capture. `javaScript: false` shows the page as the server sent it. */
export function visualContextOptions({ size, theme, javaScript = true, storageState }) {
  return {
    viewport: size,
    colorScheme: theme,
    reducedMotion: "reduce",
    locale: VISUAL_LOCALE,
    timezoneId: VISUAL_TIME_ZONE,
    deviceScaleFactor: 1,
    javaScriptEnabled: javaScript,
    serviceWorkers: "block",
    ...(storageState ? { storageState } : {}),
  };
}

/** The style every capture carries: nothing moves, nothing blinks. */
export const FREEZE_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";

/** Runs before the page's own scripts: the theme the app reads, no View Transition. */
export const initVisualPage = ({ theme, themeKey }) => {
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    /* storage can be blocked: the colour scheme of the context still applies */
  }
};

/** Prepares a page: fixed time, the theme key, no View Transition. Call before the first `goto`. */
export async function prepareVisualPage(page, { theme, themeKey = "kz-theme", now = FROZEN_TIME } = {}) {
  // Date is fixed, timers still run: the app finishes loading.
  await page.context().clock.setFixedTime(new Date(now));
  await page.addInitScript(initVisualPage, { theme, themeKey });
  await page.addInitScript(withoutViewTransitions);
}

/** Waits until what is on screen is final: the faces, the images, the transitions. */
export async function settleForShot(page, { javaScript = true } = {}) {
  await page.addStyleTag({ content: FREEZE_CSS });
  if (!javaScript) return;
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
  await page.evaluate(() =>
    Promise.all([...document.images].filter((img) => !img.complete).map((img) => img.decode().catch(() => undefined))),
  );
}

/** The options of `toHaveScreenshot`: a small tolerance for anti-aliasing, never for a missing element. */
export function shotOptions({ mask = [], page } = {}) {
  return {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    maxDiffPixelRatio: 0.002,
    ...(page && mask.length ? { mask: mask.map((selector) => page.locator(selector)) } : {}),
  };
}

/**
 * Registers one test per journey × viewport × theme.
 *
 * journey: { name, path, session?: boolean, mask?: string[] (selectors of live values), ready?: selector | (page) => Promise,
 *            viewports?: string[], firstPaint?: true | { hold: string[] } }
 *   firstPaint: the page before it is alive. `true` turns JavaScript off (the HTML the server sent); `{ hold }` keeps JavaScript
 *   but never answers the listed URL patterns (the account query, say), so the account mark is captured while its query is pending.
 * signIn(page, { base }): signs the persona in; its cookies are kept and reused by every signed-in capture of the worker.
 */
export function defineJourneyTests({ test, expect, journeys, signIn, base, viewports = VIEWPORTS, themes = VISUAL_THEMES, themeKey = "kz-theme" }) {
  let session;
  const sessionState = (browser) => {
    session ??= (async () => {
      const context = await browser.newContext(visualContextOptions({ size: viewports.desktop ?? Object.values(viewports)[0], theme: "light" }));
      const page = await context.newPage();
      await signIn(page, { base });
      const state = await context.storageState();
      await context.close();
      return state;
    })();
    return session;
  };
  for (const journey of journeys) {
    for (const cell of visualMatrix(journey, { viewports, themes })) {
      test(`${journey.name} · ${cell.viewport} · ${cell.theme}${journey.firstPaint ? " · first paint" : ""}`, async ({ browser, baseURL }) => {
        const origin = base ?? baseURL;
        const javaScript = !(journey.firstPaint === true);
        const storageState = journey.session ? await sessionState(browser) : undefined;
        const context = await browser.newContext(visualContextOptions({ size: cell.size, theme: cell.theme, javaScript, storageState }));
        try {
          const page = await context.newPage();
          await prepareVisualPage(page, { theme: cell.theme, themeKey });
          for (const pattern of journey.firstPaint?.hold ?? []) await page.route(pattern, () => undefined);
          await page.goto(new URL(journey.path, origin).toString(), { waitUntil: journey.firstPaint ? "domcontentloaded" : "load" });
          if (typeof journey.ready === "string") await page.locator(journey.ready).first().waitFor();
          else if (journey.ready) await journey.ready(page);
          await settleForShot(page, { javaScript });
          await expect(page).toHaveScreenshot(cell.snapshot, shotOptions({ mask: journey.mask, page }));
        } finally {
          await context.close();
        }
      });
    }
  }
}
