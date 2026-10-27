// The audit proven on its own fixtures, in a real browser: each broken fixture must be reported, the fine ones must not.
// A guard that stopped seeing is itself a red build.
import { CARD_OVER_NEXT, COLUMN_CUT, FINE, FOLDED_SECTION, HIDDEN_CONTENT, SECTIONS_OVERLAP } from "./fixtures.mjs";
import { auditPage, problemsOf } from "./page-audit.mjs";
import { auditContext } from "./settle.mjs";

const EXPECT = [
  ["a card taller than its panel", CARD_OVER_NEXT, /overflows its panel/],
  ["a card over the next section", CARD_OVER_NEXT, /covers a neighbouring section/],
  ["two sections on top of each other", SECTIONS_OVERLAP, /covers a neighbouring section/],
  ["a column cut by a clipping wrapper", COLUMN_CUT, /is cut off/],
];
const FINES = [
  ["a fine layout", FINE],
  ["content that is not drawn (a visually hidden table, a folded details)", HIDDEN_CONTENT],
  ["a section folded in a details", FOLDED_SECTION],
];

/** @returns {Promise<string[]>} the failures (empty when the audit sees what it must and nothing else) */
export async function selfTest({ launch } = {}) {
  const browser = launch ? await launch() : await (await import("playwright-core")).chromium.launch();
  const failures = [];
  try {
    const page = await (await auditContext(browser, { viewport: { width: 1280, height: 800 } })).newPage();
    for (const [name, html, pattern] of EXPECT) {
      await page.setContent(html);
      const problems = problemsOf("fixture", await page.evaluate(auditPage));
      if (!problems.some((p) => pattern.test(p))) failures.push(`the audit does not see ${name}: ${problems.join(" | ") || "no problem reported"}`);
    }
    for (const [name, html] of FINES) {
      await page.setContent(html);
      const fine = problemsOf("fixture", await page.evaluate(auditPage));
      if (fine.length) failures.push(`the audit reports ${name}: ${fine.join(" | ")}`);
    }
  } finally {
    await browser.close();
  }
  return failures;
}
