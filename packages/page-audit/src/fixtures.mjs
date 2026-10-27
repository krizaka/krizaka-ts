// Small pages that reproduce what the layout audit must catch (yomizaka#435) and one that is fine, for `check-page-audit.mjs`:
// the guard is proven on its own fixtures before it is trusted on the app.

const page = (body, css = "") => `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:16px sans-serif}${css}</style></head><body><main>${body}</main></body></html>`;

/** The binder as it was: the open folder's card is as tall as its grid row (a fixed height) and runs over the next section. */
export const CARD_OVER_NEXT = page(
  `<section data-testid="binder" style="height:200px"><h2>Le classeur</h2><div data-testid="collection-card" style="height:500px">Mes documents · 0 fichiers</div></section><section data-testid="latest-checks"><h2>Dernières vérifications</h2></section>`,
  "section{display:block}",
);
/** Two sections laid out on top of each other. */
export const SECTIONS_OVERLAP = page(`<section data-testid="a" style="height:100px">A</section><section data-testid="b" style="margin-top:-60px;height:100px;position:relative">B</section>`);
/** A two-column layout whose wrapper clips the right column. */
export const COLUMN_CUT = page(
  `<div style="overflow:hidden;width:600px"><div style="display:grid;grid-template-columns:400px 400px"><section data-testid="main">Main</section><aside data-testid="activity"><section data-testid="activity-figures">Activité</section></aside></div></div>`,
);
/** What it should be: the card follows its content, the columns fit, a wide table scrolls inside its own scroller. */
export const FINE = page(
  `<div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px"><section data-testid="binder"><h2>Le classeur</h2><div data-testid="collection-card">Mes documents · 0 fichiers</div></section><aside><section data-testid="activity">Activité</section></aside></div><section data-testid="latest-checks"><h2>Dernières vérifications</h2><div style="overflow:auto;width:300px"><div style="width:900px">table</div></div></section>`,
);
/** Not drawn, so not a problem: a chart's text version in a visually hidden wrapper, and the content of a folded `<details>` (the browser still gives both a box). */
export const HIDDEN_CONTENT = page(
  `<section data-testid="activity" style="height:120px"><h2>Activité</h2><div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)"><table><tbody>${"<tr><td>21 oct.</td><td>7</td></tr>".repeat(40)}</tbody></table></div></section><section data-testid="report"><details><summary>Détails</summary><div style="height:400px">Texte du rapport</div></details></section>`,
);

/** The report tab: a section inside a folded details (the closing note) beside sections it must not be taken to cover. */
export const FOLDED_SECTION = page(
  `<div style="display:flex;flex-direction:column"><section data-testid="facts" style="height:80px">Faits</section><details><summary>Détails</summary><section data-testid="closing-note" style="padding:16px">Ce que nous avons vérifié</section></details><section data-testid="other" style="height:80px">Autres</section></div>`,
);
