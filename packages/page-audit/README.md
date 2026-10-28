# @krizaka/page-audit

The page audit of every Krizaka app, in one place (ADR-013: one source per rule set). It measures a rendered page in a real browser:
horizontal overflow, a card out of its panel, sections covering each other, a column cut by a clipping ancestor, top chrome that
overlaps, content cut inside its box, a token wrapped per character, unnamed buttons, empty headings. Closed `<details>`, `aria-hidden`
layers, scrollers and fixed elements are not counted. Library code, not UI: it lives in krizaka-ts.

```bash
npm i -D @krizaka/page-audit playwright-core
npx krizaka-page-audit --self-test                                       # proves it on its own fixtures
npx krizaka-page-audit --base http://localhost:3000 --routes /en,/fr --widths 360,390,1440 --themes dark,light
```

```js
import { auditRoutes, auditContext, loadSettled, resizeSettled, auditPage, problemsOf } from "@krizaka/page-audit";
const problems = await auditRoutes({ base, routes: ["/en", "/fr"], checks: { h1: true } }); // [] when fine
```

`auditContext` / `loadSettled` / `resizeSettled` open a context with reduced motion and no View Transition, and wait for none to run
before anything is measured (yomizaka#354). `prepare(page, route)` signs in or seeds; `launch` gives your own browser.

## The dev-preview crawls, in one audit (0.3)

Opt-in through `checks` (nothing changes for a repo that does not ask): `status` (HTTP 4xx/5xx or no response), `emptyMain`, `frame`
(the signed-in frame, `[data-app-frame-slot]`, forces a scroll), `minAction` (a button-styled action under N px), `boxes` (a landmark
wider than its box), `landmarks` (`"public"` one footer naming Krizaka and a nav, `"app"`, `"auth"`), `pictures`, `emptyControls`,
`hardColors`, `maps` (an empty map, akinaza#488: a GL / Leaflet / `[data-kz-map]` box under 120 px on a side, a GL map with no canvas,
a Leaflet map with no loaded tile; `maps: { required: true }` also fails a page that should draw one but has none). Console noise the app tolerates: `ignoreConsole: [/…/]` (`[]` counts every error); `attempts` retries a route.

```js
const routes = await routesFromSitemap(base, { first: ["/", "/docs"], limit: 14 }); // a crawl as the route source (null: nothing answers)
await auditRoutes({
  base, routes: [...routes, { url: "/login", chrome: "auth" }, { url: "/chat", session: true, chrome: "app" }],
  widths: [{ width: 1440, height: 900 }, { width: 390, height: 844 }],
  session: { storageState }, // or { signIn(context, { base, theme }) {…}, routes: async (page) => […] } for pages found once signed in
  a11y: { app: "my-app", baseline: "a11y-baseline.json", widths: [390, 1440], session: { app: "my-app-app", baseline: "a11y-baseline.app.json" } },
  checks: { status: true, emptyMain: true, minAction: 36, landmarks: "public", frame: true },
});
```

`a11y` runs axe through `@krizaka/a11y-audit` (an optional peer) and ratchets with the repo's own baseline file; `--a11y-update` and
`--a11y-init` work as there. The CLI takes `--sitemap`, `--status`, `--empty-main`, `--min-action`, `--a11y app:baseline.json`.
