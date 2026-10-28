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

/** A page whose `<main>` draws nothing. */
export const EMPTY_MAIN = page("");
/** The signed-in frame asks 1000 px of a 700 px screen under a 60 px notice (akinaza#444). */
export const FRAME_FORCES_SCROLL = page(`<div style="height:60px">notice</div><div data-app-frame-slot><div style="min-height:1000px">shell</div></div>`);
/** The same frame, sized to what is left of the screen. */
export const FRAME_FITS = page(`<div style="height:60px">notice</div><div data-app-frame-slot><div style="min-height:500px">shell</div></div>`);
/** A button-styled action 24 px tall, under the 36 px tap target. */
export const SMALL_ACTION = page(`<a class="kz-button" href="/" style="display:block;height:24px;width:120px">Go</a>`);
/** A landmark whose content is wider than its box. */
export const BOX_TOO_WIDE = page(`<aside style="width:200px"><div style="width:500px">wide</div></aside>`);
/** Broken picture, a tile that draws nothing, an inline hard-coded colour. */
export const BROKEN_PARTS = page(`<img src="data:image/png;base64,AAAA" width="40" height="40" alt=""><a href="/" style="display:block;width:60px;height:60px"></a><p style="color:#ff0000">x</p>`);
/** Chrome that fits the family: one footer naming Krizaka, a nav. */
export const CHROME_FINE = `<!doctype html><html><body><nav>n</nav><main><p>Hello</p></main><footer>A Krizaka product</footer></body></html>`;
export const CHROME_BAD = `<!doctype html><html><body><main><p>Hello</p></main><footer>one</footer><footer>two</footer></body></html>`;

/** A short token in a table row stretched by a tall neighbour: the cell is tall, its text is one line. */
export const TOKEN_IN_STRETCHED_ROW = page(`<table style="width:600px"><tbody><tr><td>orazaka-media-pack</td><td>${"A long description. ".repeat(30)}</td></tr></tbody></table>`);
/** An identifier in a narrow cell that breaks every few characters. */
export const TOKEN_WRAPPED = page(`<table style="width:100px;table-layout:fixed"><tbody><tr><td style="word-break:break-all;font-size:20px">abcdefghijklmnopqrstuvwxyz0123456789</td></tr></tbody></table>`);

/** A map that laid out at 0 px: `absolute inset-0` in a frame with no height of its own (akinaza#488). */
export const MAP_COLLAPSED = page(`<section><div style="position:relative"><div class="maplibregl-map" style="position:absolute;inset:0"><canvas width="0" height="0"></canvas></div></div></section>`);
/** A map box with a size and a canvas, and a Leaflet one with a loaded tile. */
export const MAP_FINE = page(`<section><div class="maplibregl-map" style="height:300px;width:600px"><canvas style="width:600px;height:300px" width="600" height="300"></canvas></div><div class="leaflet-container" style="height:300px;width:600px"><img class="leaflet-tile-loaded" alt="" width="256" height="256"></div></section>`);
/** A GL map box of a good size where nothing was drawn (no canvas). */
export const MAP_NO_CANVAS = page(`<section><div class="maplibregl-map" style="height:300px;width:600px"></div></section>`);
/** A map that is not drawn (display none: a closed tab, a small screen): nothing to measure. */
export const MAP_HIDDEN = page(`<section><div class="maplibregl-map" style="display:none"></div></section>`);
