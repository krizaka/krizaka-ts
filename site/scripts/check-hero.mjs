/* The home's hero, measured in a real browser: one install command, never clipped (the line fits its block or scrolls inside
   the code block only), in one frame, with no band of figures under the hero, and the facts as a specimen tag. Run on the
   home by check-overflow.mjs (at 360 and 1440 px, both languages and themes), which CI runs on the built site. */

/** The widths the hero is measured at. */
export const HERO_WIDTHS = [360, 1440];

/** Runs in the page: what is wrong with the install command's content. */
function commandProblems() {
  const hero = document.querySelector(".kz-hero-aside");
  if (!hero) return ["the hero has no aside (the install command)"];
  const shown = [...hero.querySelectorAll("pre")].filter((p) => p.getClientRects().length > 0);
  if (shown.length !== 1) return [`${shown.length} install commands are shown, expected 1`];
  const text = shown[0].textContent ?? "";
  const out = [];
  if (!text.includes("npm install @krizaka/db")) out.push(`the command is "${text.trim()}"`);
  if (text.split("@krizaka/").length !== 2) out.push("the command lists more than one package");
  if (shown[0].parentElement.parentElement.querySelectorAll("pre").length !== 1) out.push("more than one frame");
  return out;
}

/** Runs in the page: whether the command line is clipped, by itself or by a parent. */
function clipProblems() {
  const pre = [...document.querySelectorAll(".kz-hero-aside pre")].find((p) => p.getClientRects().length > 0);
  if (!pre) return [];
  const out = [];
  const overflowX = getComputedStyle(pre).overflowX;
  if (pre.scrollWidth > pre.clientWidth + 1 && !["auto", "scroll"].includes(overflowX))
    out.push(
      `the line is clipped: scrollWidth ${pre.scrollWidth} > clientWidth ${pre.clientWidth}, overflow-x ${overflowX}`,
    );
  const box = pre.getBoundingClientRect();
  if (box.right > document.documentElement.clientWidth + 1)
    out.push(`the command spans to ${Math.round(box.right)}px, past the window`);
  for (let p = pre.parentElement; p && p !== document.body; p = p.parentElement) {
    const r = p.getBoundingClientRect();
    const clips = ["hidden", "clip"].includes(getComputedStyle(p).overflowX);
    if (clips && (box.right > r.right + 1 || box.left < r.left - 1))
      out.push(`the command is clipped by <${p.tagName.toLowerCase()}>`);
  }
  return out;
}

/** Runs in the page: the band of figures is gone and the facts are a specimen tag. */
function bandProblems() {
  const out = [];
  if (document.querySelector(".kz-tpl-band")) out.push("the figures band is still there");
  if (!document.querySelector(".jh-facts")) out.push("the facts are not in a specimen tag under the actions");
  return out;
}

/** What is wrong with the hero of the page, as sentences (empty when it is right). */
export async function heroProblems(page) {
  const found = await Promise.all([
    page.evaluate(commandProblems),
    page.evaluate(clipProblems),
    page.evaluate(bandProblems),
  ]);
  return found.flat();
}
