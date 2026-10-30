// The audit proven on its own fixtures, in a real browser: each broken fixture must be reported, the fine ones must not.
// A guard that stopped seeing is itself a red build.
import {
  BOX_TOO_WIDE,
  BROKEN_PARTS,
  CARD_OVER_NEXT,
  CHROME_BAD,
  CHROME_FINE,
  COLUMN_CUT,
  EMPTY_MAIN,
  FINE,
  FOLDED_SECTION,
  FRAME_FITS,
  FRAME_FORCES_SCROLL,
  HIDDEN_CONTENT,
  MAP_COLLAPSED,
  MAP_FINE,
  MAP_HIDDEN,
  MAP_NO_CANVAS,
  SECTIONS_OVERLAP,
  SMALL_ACTION,
  TOKEN_IN_STRETCHED_ROW,
  TOKEN_WRAPPED,
} from "./fixtures.mjs";
import { auditPage, problemsOf } from "./page-audit.mjs";
import { auditContext } from "./settle.mjs";

const EXPECT = [
  ["a card taller than its panel", CARD_OVER_NEXT, /overflows its panel/],
  ["a card over the next section", CARD_OVER_NEXT, /covers a neighbouring section/],
  ["two sections on top of each other", SECTIONS_OVERLAP, /covers a neighbouring section/],
  ["a column cut by a clipping wrapper", COLUMN_CUT, /is cut off/],
  ["an identifier that breaks every few characters", TOKEN_WRAPPED, /wraps one character per line/],
  ["an empty <main>", EMPTY_MAIN, /empty <main>/, { emptyMain: true }],
  ["a frame that forces a scroll", FRAME_FORCES_SCROLL, /the frame forces a scroll/, { frame: true }],
  ["an action under the tap target", SMALL_ACTION, /an action is 24 px tall \(< 36\)/, { minAction: 36 }],
  ["a landmark wider than its box", BOX_TOO_WIDE, /content wider than its box/, { boxes: true }],
  ["a broken picture", BROKEN_PARTS, /broken picture/, { pictures: true }],
  ["a tile that draws nothing", BROKEN_PARTS, /empty tile/, { emptyControls: true }],
  ["a hard-coded inline colour", BROKEN_PARTS, /hard-coded colour/, { hardColors: true }],
  ["a map that laid out at 0 px", MAP_COLLAPSED, /the map .* is \d+x0 px \(empty\)/, { maps: true }],
  ["a map with no canvas", MAP_NO_CANVAS, /has no canvas/, { maps: true }],
  ["no map where one is required", FINE, /no map on the page/, { maps: { required: true } }],
  ["two page footers and no nav", CHROME_BAD, /2 page footers/, { landmarks: "public" }],
  ["no nav landmark", CHROME_BAD, /no <nav> landmark/, { landmarks: "app" }],
];
const FINES = [
  ["a fine layout", FINE],
  ["content that is not drawn (a visually hidden table, a folded details)", HIDDEN_CONTENT],
  ["a section folded in a details", FOLDED_SECTION],
  ["a short token in a row a taller neighbour stretches", TOKEN_IN_STRETCHED_ROW],
];
/** Fixtures that must stay clean even with every opt-in check on. */
const ALL = {
  emptyMain: true,
  frame: true,
  minAction: 36,
  boxes: true,
  pictures: true,
  emptyControls: true,
  hardColors: true,
  landmarks: "public",
  maps: true,
};
const FINES_STRICT = [
  ["a frame that fits its screen", FRAME_FITS, { frame: true, emptyMain: false }],
  ["the family chrome", CHROME_FINE, ALL],
  ["maps with a size and something drawn", MAP_FINE, { maps: true }],
  ["a map that is not drawn (display none)", MAP_HIDDEN, { maps: true }],
];

async function problemsOn(page, html, checks) {
  await page.setContent(html);
  return problemsOf("fixture", await page.evaluate(auditPage), checks);
}

/** The failure for a fixture that must be clean and is not (none, when it is). */
async function reported(page, name, html, checks) {
  const fine = await problemsOn(page, html, checks);
  return fine.length ? [`the audit reports ${String(name)}: ${fine.join(" | ")}`] : [];
}

/** @returns {Promise<string[]>} the failures (empty when the audit sees what it must and nothing else) */
export async function selfTest({ launch } = {}) {
  const browser = launch ? await launch() : await (await import("playwright-core")).chromium.launch();
  const failures = [];
  try {
    const page = await (await auditContext(browser, { viewport: { width: 1280, height: 800 } })).newPage();
    for (const [name, html, pattern, checks] of EXPECT) {
      const problems = await problemsOn(page, html, checks);
      if (!problems.some((p) => pattern.test(p)))
        failures.push(`the audit does not see ${String(name)}: ${problems.join(" | ") || "no problem reported"}`);
    }
    for (const [name, html] of FINES) failures.push(...(await reported(page, name, html)));
    await page.setViewportSize({ width: 1280, height: 700 });
    for (const [name, html, checks] of FINES_STRICT) failures.push(...(await reported(page, name, html, checks)));
  } finally {
    await browser.close();
  }
  return failures;
}
