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
