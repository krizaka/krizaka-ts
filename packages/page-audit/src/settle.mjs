// One way for every browser audit to measure (yomizaka#354): never while a View Transition is swapping the page.
//
// The flake: the page was read while a transition was running (« Viewport size changed », 0 of 2 h1). The cure is the
// same everywhere, so it lives here and nowhere else: the context emulates reduced motion (the app honours it, the page
// change is instant — motion.css of @krizaka/ui) and every load or resize waits, explicitly, until no transition is
// active. No retry, no sleep standing in for a condition. `tests/browser-audits.test.mjs` fails a script that
// opens a context, loads a page or resizes without these.

/** The options of an audit's browser context: the caller's, plus reduced motion. */
export const auditOptions = (options = {}) => ({ ...options, reducedMotion: "reduce" });

/**
 * Runs before any page script: the browser offers no View Transition, so PageTransition (@krizaka/ui) changes the page
 * at once. Reduced motion alone is not enough: the transition still starts, and a resize or a load under it, or a slow
 * runner, makes the browser log « Transition was aborted » / « DOM update timed out » as a console error that has
 * nothing to do with the page (main and two PRs, 2026-10-27). An audit measures layout, not motion.
 */
export const withoutViewTransitions = () => {
  Object.defineProperty(Document.prototype, "startViewTransition", { value: undefined, configurable: true });
};

/** A browser context for an audit (reduced motion emulated, no View Transition). */
export async function auditContext(browser, options) {
  const context = await browser.newContext(auditOptions(options));
  await context.addInitScript(withoutViewTransitions);
  return context;
}

/** Resolves once no view transition is running (none starts under reduced motion; this makes the wait explicit). */
export const settled = (page) =>
  page.waitForFunction(
    () => !document.activeViewTransition && !document.documentElement.matches(":active-view-transition"),
    null,
    { timeout: 10_000 },
  );

/**
 * Loads a page, then waits for the faces and for the transitions: what is read afterwards is final. Returns the response.
 * It first lets the page we are leaving finish any transition it started after the last measure (a router refresh, a
 * poll): leaving one running aborts it, and the browser reports « Transition was aborted » as a console error (#354).
 */
export async function loadSettled(page, url, options = { waitUntil: "load" }) {
  if (page.url() !== "about:blank") await settled(page);
  const response = await page.goto(url, options);
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
  return response;
}

/**
 * Resizes the viewport, then waits for the transitions a resize can start. A transition already running is let finish
 * first: a resize under it aborts it (« Viewport size changed », a console error), which is how this audit once failed.
 */
export async function resizeSettled(page, size) {
  await settled(page);
  await page.setViewportSize(size);
  await settled(page);
}
