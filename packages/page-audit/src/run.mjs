// The audit over a route list: every route × viewport width × theme, in a real browser, the problems in words.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { auditPage, problemsOf } from "./page-audit.mjs";
import { auditContext, loadSettled, resizeSettled } from "./settle.mjs";

export const WIDTHS = [360, 390, 430, 768, 1024, 1440];
export const THEMES = ["dark", "light"];

/** A blocked third-party resource is not a page error; a script error and a hydration mismatch are. `ignore`: the messages the app tolerates. */
export const isPageError = (message, ignore = [/Failed to load resource/]) =>
  message.type() === "error" && !ignore.some((re) => re.test(message.text()));

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
function collectErrors(page, ignore) {
  let errors = [];
  page.on("console", (m) => {
    if (isPageError(m, ignore)) errors.push(m.text().slice(0, 140));
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

const viewportOf = (w, height) => (typeof w === "number" ? { width: w, height } : { height, ...w });
const specOf = (r) => (typeof r === "string" ? { url: r } : { ...r, url: r.url ?? r.route });
const nameOfRoute = (r) => r.name ?? r.url;

/**
 * A route source that is a crawl: the paths of the site's own sitemap (a page added there is audited), the `first` ones always first,
 * at most `limit`. Returns `null` when nothing answers at `${base}/sitemap.xml` (the caller says so and stops).
 * @param {string} base
 * @param {{ first?: string[], limit?: number, fetcher?: typeof fetch }} [o]
 * @returns {Promise<string[] | null>}
 */
export async function routesFromSitemap(base, { first = ["/"], limit = 14, fetcher = fetch } = {}) {
  const origin = base.replace(/\/$/, "");
  const xml = await fetcher(`${origin}/sitemap.xml`).then(
    (r) => (r.ok ? r.text() : null),
    () => null,
  );
  if (xml === null) return null;
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname || "/");
  return [...new Set([...first, ...paths])].slice(0, limit);
}

/** The optional axe step: `@krizaka/a11y-audit` (a peer, loaded only when asked), one collector per kind of page, each ratcheted by the repo's own baseline file. */
async function a11yOf(a11y) {
  if (!a11y) return null;
  const lib = await import("@krizaka/a11y-audit");
  const kinds = { public: { collector: new lib.A11yCollector(a11y.app), baseline: a11y.baseline } };
  if (a11y.session)
    kinds.session = {
      collector: new lib.A11yCollector(a11y.session.app),
      baseline: a11y.session.baseline,
      optional: true,
    };
  return {
    lib,
    kinds,
    widths: a11y.widths ?? [390, 1440],
    log: a11y.log ?? ((line) => process.stdout.write(`${line}\n`)),
  };
}

/** The ratchet's verdict, per kind. A baseline not recorded yet (`optional`) is counted, not enforced, until `--a11y-init`. */
function a11yProblems(state) {
  const problems = [];
  for (const { collector, baseline, optional } of Object.values(state.kinds)) {
    if (optional && !existsSync(baseline) && !process.argv.includes("--a11y-init")) {
      state.log(
        `· a11y baseline missing: counted, not enforced (${collector.summary().join("; ") || "no violation"}); record it with --a11y-init`,
      );
      continue;
    }
    const guard = state.lib.finish(collector, { baseline });
    for (const note of guard.notes) state.log(note);
    problems.push(...guard.problems);
  }
  return problems;
}

/** The HTTP status of the load when asked for (`null`: no response), else `undefined`. */
function statusOf(response, checks) {
  if (!checks.status) return undefined;
  return response ? response.status() : null;
}

/** One route at one width: load, settle, measure, screenshot. */
async function measure(
  page,
  { base, spec, viewport, settleMs, prepare, checks, errors, where, shots, a11y, kind, theme },
) {
  await resizeSettled(page, viewport);
  // « load » and the faces, not « networkidle »: router prefetches can keep the page from ever going idle.
  const response = await loadSettled(page, `${base}${spec.url}`);
  if (prepare) await prepare(page, spec.url);
  if (settleMs) await page.waitForTimeout(settleMs);
  const result = await page.evaluate(auditPage);
  if (a11y?.widths.includes(viewport.width)) {
    const { collector } = a11y.kinds[kind] ?? a11y.kinds.public;
    collector.add({ route: spec.url, theme }, await a11y.lib.auditPage(page));
  }
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${where.replace(/[/?=&@ ]/g, "_")}.png`) });
  }
  const status = statusOf(response, checks);
  const landmarks = spec.chrome ?? checks.landmarks;
  return problemsOf(where, result, { ...checks, landmarks, status, errors: errors.take() });
}

/** One route at one width, with `attempts` tries before it counts as « could not be audited ». */
async function measureWithRetries(page, o, spec, viewport, where) {
  let failure;
  for (let attempt = 1; attempt <= o.attempts; attempt++) {
    try {
      return await measure(page, { ...o, spec, viewport, where });
    } catch (error) {
      failure = error;
    }
  }
  return [`${where}: could not be audited — ${String(failure?.message).split("\n")[0]}`];
}

/** Audits the routes of one page (one context), each width. */
async function auditPageRoutes(page, routes, o) {
  const problems = [];
  for (const spec of routes) {
    for (const w of o.widths) {
      const viewport = viewportOf(w, o.height);
      problems.push(
        ...(await measureWithRetries(page, o, spec, viewport, `${nameOfRoute(spec)} @${viewport.width} ${o.theme}`)),
      );
    }
  }
  return problems;
}

async function newPage(browser, o, extra = {}) {
  const context = await auditContext(browser, { colorScheme: o.theme, ...extra });
  if (o.themeKey) await context.addInitScript(rememberTheme, [o.themeKey, o.theme]);
  const page = await context.newPage();
  return { context, page, errors: collectErrors(page, o.ignoreConsole) };
}

/** The signed-in pages of one theme: a context with the session (a stored state, or `signIn` on the context), the routes the session names, then the flagged ones. */
async function auditSession(browser, session, flagged, o) {
  const { context, page, errors } = await newPage(
    browser,
    o,
    session.storageState ? { storageState: session.storageState } : {},
  );
  try {
    if (session.signIn) await session.signIn(context, { base: o.base, theme: o.theme, page });
    const own = session.routes ? await session.routes(page, { base: o.base, theme: o.theme }) : [];
    return await auditPageRoutes(page, [...own, ...flagged].map(specOf), { ...o, errors, kind: "session" });
  } finally {
    await context.close();
  }
}

/**
 * @param {object} o
 * @param {string} o.base  origin of the running app
 * @param {Array<string | { url: string, name?: string, chrome?: "public" | "app" | "auth", session?: boolean }>} o.routes  paths to audit (a route flagged `session` is audited signed in; `chrome` replaces `checks.landmarks` for that route)
 * @param {Array<number | { width: number, height?: number }>} [o.widths]  viewports (default widths 360 to 1440)
 * @param {string[]} [o.themes]  "dark" | "light" (default both): emulated colour scheme and, when `themeKey` is set, localStorage
 * @param {number} [o.height]  viewport height (default 900)
 * @param {string} [o.themeKey]  localStorage key the app persists its theme in (default "kz-theme")
 * @param {string} [o.shots]  directory for one screenshot per route × width × theme
 * @param {number} [o.settleMs]  pause after load, for late layout (default 300)
 * @param {object} [o.checks]  options of `problemsOf`: h1, headerAction, fileLabels, and the opt-in status, emptyMain, frame, minAction, boxes, landmarks, pictures, emptyControls, hardColors
 * @param {RegExp[]} [o.ignoreConsole]  console errors the app tolerates (default: « Failed to load resource »; `[]` counts every error)
 * @param {number} [o.attempts]  tries per route before it counts as not audited (default 1)
 * @param {{ app: string, baseline: string, widths?: number[], log?: (line: string) => void, session?: { app: string, baseline: string } }} [o.a11y]  the axe step (`@krizaka/a11y-audit`, a peer) and the repo's ratchet file
 * @param {{ storageState?: object | string, signIn?: Function, routes?: Function }} [o.session]  how the signed-in pages are reached
 * @param {(page: object, route: string) => Promise<void>} [o.prepare]  before each route is measured (sign in, seed)
 * @param {() => Promise<object>} [o.launch]  returns a Playwright browser (default: chromium of playwright-core)
 * @returns {Promise<string[]>} the problems, empty when the pages are fine
 */
export async function auditRoutes({
  base,
  routes,
  widths = WIDTHS,
  themes = THEMES,
  height = 900,
  themeKey = "kz-theme",
  shots,
  settleMs = 300,
  checks = {},
  ignoreConsole,
  attempts = 1,
  a11y,
  session,
  prepare,
  launch,
}) {
  const browser = await chromiumOf(launch);
  const state = await a11yOf(a11y);
  const specs = routes.map(specOf);
  const plain = specs.filter((r) => !r.session);
  const flagged = specs.filter((r) => r.session);
  const problems = [];
  try {
    for (const theme of themes) {
      const o = {
        base,
        widths,
        height,
        theme,
        themeKey,
        shots,
        settleMs,
        checks,
        ignoreConsole,
        attempts,
        prepare,
        a11y: state,
      };
      const { context, page, errors } = await newPage(browser, o);
      problems.push(...(await auditPageRoutes(page, plain, { ...o, errors, kind: "public" })));
      await context.close();
      if (session && (session.routes || flagged.length))
        problems.push(...(await auditSession(browser, session, flagged, o)));
    }
  } finally {
    await browser.close();
  }
  if (state) problems.push(...a11yProblems(state));
  return problems;
}
