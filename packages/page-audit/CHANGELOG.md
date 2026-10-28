# @krizaka/page-audit

## 0.4.0

### Minor Changes

- e23dcb2: `maps` check: an empty map fails the audit (a GL / Leaflet / `[data-kz-map]` box under 120 px on a side, a GL map with no canvas, a Leaflet map with no loaded tile; `maps: { required: true }` also fails a page that should draw one). Proven on its own fixtures in the self-test (krizaka-ts#199, akinaza#488).

## 0.3.1

### Patch Changes

- 8656e38: A token in a table cell is not « wrapped one character per line » because a taller neighbour stretches its row: the check measures the text's own lines, not the cell's box.

## 0.3.0

### Minor Changes

- 2da1174: The union of the dev-preview crawls (krizaka-ui#747): opt-in HTTP status, empty `<main>`, signed-in frame forced scroll, minimum action height, landmark wider than its box, page chrome (footer, nav), broken pictures, empty tiles and hard-coded inline colours; an optional axe step through `@krizaka/a11y-audit` with the repo's own baseline (the ratchet stays per repo); a crawl route source (`routesFromSitemap`), per-route `chrome` and `session` (stored state or sign-in), per-viewport heights, `ignoreConsole` and `attempts`.

## 0.2.0

### Minor Changes

- 216794b: New package: the page audit of every Krizaka app in one place (overflow, containment, overlap, cut columns, top chrome overlaps, closed `<details>` skipped, View Transitions neutralised, `auditContext`/`settle`), an `auditRoutes` API over routes x widths x themes, a `krizaka-page-audit` bin with a `--self-test` on fixtures. Ported from yomizaka with its tests (krizaka-ui#747).
