# @krizaka/config

**The shared configuration of every Krizaka JavaScript repository.** ESLint flat configs (base, Next.js, the four UI
rules, the three stack rules, no locale ternary), the dependency-cruiser boundary, tsconfig bases, Prettier,
EditorConfig — and `krizaka-ratchet`, the counter that keeps the UI and stack debts from coming back.

[![npm](https://img.shields.io/npm/v/@krizaka/config?color=3b82f6&label=npm)](https://www.npmjs.com/package/@krizaka/config)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/krizaka/krizaka-ts/blob/main/LICENSE)

## Adopt it in three lines

```bash
npm install -D @krizaka/config eslint typescript     # + eslint-config-next for a Next.js app, prettier if you format
```

```js
// eslint.config.mjs — a Next.js app (a library: `krizakaBase` from "@krizaka/config/eslint")
import { krizakaNext } from "@krizaka/config/eslint/next";
import { krizakaUi } from "@krizaka/config/eslint/krizaka-ui";
import { noLocaleTernary } from "@krizaka/config/eslint/no-locale-ternary";
import { krizakaStack } from "@krizaka/config/eslint/stack";

export default [...krizakaNext, ...krizakaUi(), ...krizakaStack(), ...noLocaleTernary()];
```

```js
// .dependency-cruiser.cjs — « Krizaka first », cycles, unresolvable imports, dev dependencies, plus the app's own rules
module.exports = { extends: "@krizaka/config/dependency-cruiser", forbidden: [] };
```

```jsonc
// tsconfig.json — base · react-library · next · react-native
{ "extends": "@krizaka/config/tsconfig/next.json", "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"] }
```

Prettier: `export { default } from "@krizaka/config/prettier";` in `prettier.config.js` (120 columns, double quotes,
trailing commas). EditorConfig: `cp node_modules/@krizaka/config/.editorconfig .`.

`eslint` ^9 and `typescript` ^5 are peer dependencies; `eslint-config-next` (Next.js apps) and `prettier` are optional
peers. The plugins (`typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-simple-import-sort`) come with
the package.

## What is inside

| Export                                                                            | What it gives                                                                                                                                                                                                                                                                                                                                                     |
| :-------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@krizaka/config/eslint`                                                          | `krizakaBase`: `@eslint/js` + `typescript-eslint` recommended, React hooks, import ordering (a warning, autofixable), ignores of generated output, `_`-prefixed unused arguments allowed.                                                                                                                                                                         |
| `@krizaka/config/eslint/next`                                                     | `krizakaNext`: `eslint-config-next` (core web vitals + TypeScript, which already carry typescript-eslint, React hooks and import) + the same basics.                                                                                                                                                                                                              |
| `@krizaka/config/eslint/krizaka-ui`                                               | `krizakaUi(options?)`: the four UI rules below. Also `krizakaUiRules` and `krizakaUiRestrictedSyntax(options?)`.                                                                                                                                                                                                                                                  |
| `@krizaka/config/eslint/no-locale-ternary`                                        | `noLocaleTernary(options?)`: `krizaka/no-locale-ternary` — no `locale === "fr" ? … : …` outside routing code.                                                                                                                                                                                                                                                     |
| `@krizaka/config/eslint/ui-warnings`                                              | `krizakaUiWarnings(options?)`: the same two debts as named plugin rules, as warnings — `krizaka/no-light-variant` (no `light:`: tokens do the theming) and `krizaka/no-raw-palette` (no `bg-zinc-900`, `text-violet-400`: a role; `allow` families). `krizaka-ratchet` counts them (`light`, `palette`), so a product adopts them now and brings the counts to 0. |
| `@krizaka/config/eslint/stack`                                                    | `krizakaStack(options?)`: the three stack rules below (warnings). Also `STACK_RULES`.                                                                                                                                                                                                                                                                             |
| `@krizaka/config/eslint/plugin`                                                   | `krizakaPlugin`: the `krizaka` plugin carrying every rule, for a hand-written config.                                                                                                                                                                                                                                                                             |
| `@krizaka/config/dependency-cruiser`                                              | The shared dependency-cruiser config, generated from the covered-domains map: one `krizaka-first-<domain>` rule per domain (dates, i18n, query, icons, ui), `no-circular`, `not-to-unresolvable`, `not-to-dev-dep`. `.withOptions({ exemptFrom })` for a monorepo whose own packages are the facades.                                                             |
| `@krizaka/config/covered-domains` · `/covered-domains.json`                       | The covered-domains map (one data file) and its helpers: the message, the patterns, the Markdown table of « Use Krizaka first ».                                                                                                                                                                                                                                  |
| `krizaka-known-violations` (bin) · `@krizaka/config/known-violations`             | The known violations of dependency-cruiser, which only shrink, see below.                                                                                                                                                                                                                                                                                         |
| `krizaka-server-client-boundary` (bin) · `@krizaka/config/server-client-boundary` | Fails when a server-rendered module imports a function from a `"use client"` `@krizaka/*` module (React #441), see below.                                                                                                                                                                                                                                         |
| `@krizaka/config/tsconfig/*.json`                                                 | `base` (strict, ES2022, bundler resolution), `react-library` (+ DOM, `react-jsx`), `next` (+ the Next plugin, `noEmit`, `incremental`), `react-native` (`jsx: react-native`, `customConditions`; with Expo: `"extends": ["expo/tsconfig.base", "@krizaka/config/tsconfig/react-native.json"]`).                                                                   |
| `@krizaka/config/prettier` · `.editorconfig`                                      | The formatting.                                                                                                                                                                                                                                                                                                                                                   |
| `krizaka-ratchet` (bin)                                                           | The debt counter, see below.                                                                                                                                                                                                                                                                                                                                      |

### The four UI rules

On every string literal inside a `className` (in `cn(…)`, a ternary…), with no plugin — `no-restricted-syntax`
selectors:

1. **No raw palette colour** — `bg-zinc-900`, `text-violet-400/80`: use a role of
   [`@krizaka/tailwind`](../tailwind) (`bg-surface-1`, `text-fg-secondary`, `border-border-default`, `text-accent`,
   `text-danger`).
2. **No `light:`** — a theme is a set of tokens; a dark island takes `.theme-dark` on its ancestor.
3. **No arbitrary `[var(--…)]` utility** — the variable has a utility in `@krizaka/tailwind`.
4. **No template literal in `className`** — `cn(…)` merges the classes and lets the override win.

```js
krizakaUi({
  allow: ["emerald"], // palette families tolerated for documented, isolated cases
  files: ["**/*.{jsx,tsx}"], // default
  ignores: ["app/og/**"], // e.g. generated OG images
  severity: "error", // "warn" while the ratchet brings the debt down
});
```

Flat config replaces a rule's options instead of concatenating them: a repository that already sets
`no-restricted-syntax` merges both lists with `krizakaUiRestrictedSyntax()`. `no-locale-ternary` is a plugin rule for
that reason — it composes with anything.

### The effect rules (react-effects)

[`useEffect` is for the outside world](https://github.com/krizaka/.github/blob/main/docs/standards/react-effects.md)
(Oussama, 2026-10-27). Two rules of `krizakaStack()`, **errors by default** (`effects: "error"`); a repository with debt
passes `effects: "warn"` while `krizaka-ratchet` (`asyncInEffect`, `derivedStateInEffect`) brings the count to 0. They
read any file (a Vite/Tauri app has no `"use client"`).

1. **`krizaka/no-async-in-effect`** — an effect that awaits, calls `.then(`, `fetch(`, `invoke(`, `api.*` or `*Client.*`:
   read with `useQuery`, write with `useMutation` (`@krizaka/query`), keyed by the selection. A subscribe-and-cleanup
   effect (`listen(`, `addEventListener(`, `subscribe(`, `WebSocket`… plus a `return`) is never reported.
2. **`krizaka/no-derived-state-in-effect`** — an effect whose only statements are `setX(…)` calls: compute the value
   during render, or reset the component with a `key`.

### Cognitive complexity (Sonar S3776)

On 2026-10-27 every failed quality gate came from Sonar's S3776 (krizaka/.github#319), and only Sonar checked it.
`krizakaStack()` now carries **`sonarjs/cognitive-complexity` at 15** (`eslint-plugin-sonarjs`; the threshold is never
raised, the rule never disabled): split the function (early returns, extracted helpers, a lookup table instead of a
chain of `if`). **Error by default** (`complexity: "error"`); a repository with debt passes `complexity: "warn"` while
`krizaka-ratchet` (`cognitiveComplexity`) freezes the count of functions over 15 at `--update` time and fails any
increase. Test files (`*.test.*`, `*.spec.*`, `__tests__/`) are not counted, as Sonar does not scan them.

### The Sonar layer (ADR-013)

`krizakaStack()` also enables the whole **`eslint-plugin-sonarjs` recommended set** (SonarCloud's JS/TS engine,
krizaka/.github#333), so Sonar's findings fail at lint time, before push. `sonar: "error"` by default; a repository with
debt passes `sonar: "warn"` while `krizaka-ratchet` freezes each rule's count (a `sonar` total and one `sonarjs/<rule>`
counter per rule with a violation) and fails any increase, or the first violation of a rule that had none. Test files are
not part of the layer (Sonar does not scan them). Rules that need type information (S2871 `no-alphabetical-sort`,
`deprecation`, `different-types-comparison`…) fire only when the lint runs with `projectService`.

Turned off, each for a stated reason (`SONAR_OFF` in `@krizaka/config/eslint/sonar`): `no-fallthrough`, `no-labels`,
`no-empty-character-class`, `no-invalid-regexp`, `no-control-regex`, `no-regex-spaces`, `no-misleading-character-class`,
`no-delete-var`, `no-useless-catch`, `generator-without-yield`, `updated-const-var` (ESLint core already enforces them),
`no-unused-vars`, `unused-import` (`@typescript-eslint/no-unused-vars`, tsc), `no-extra-arguments` (tsc),
`link-with-target-blank` (`react/jsx-no-target-blank`). `cognitive-complexity` keeps its own threshold and counter (above).
A rule is never switched off because it is noisy: fix the code or let the ratchet hold the count.

### The three stack rules

From [ADR-001](https://github.com/krizaka/krizaka-ui/blob/main/docs/adr/ADR-001-tanstack-under-krizaka-facades.md) — the TanStack engines run headless, behind
`@krizaka/*` facades; a product never imports them. Warnings: `krizaka-ratchet` counts the same patterns, so an app
adopts them before it is clean and brings each count to 0 by the end of its adoption.

1. **`krizaka/no-fetch-in-client-effect`** — a `fetch` / `krizakaFetch` inside a `useEffect` (or `useLayoutEffect`)
   of a `"use client"` file: render the first screen in a Server Component, read the rest with `@krizaka/query`.
2. **`krizaka/no-local-table-or-form`** — a `<table>`, or a `<form>` of more than one field (native fields and the field
   primitives of `@krizaka/ui`; a hidden or submit `<input>` is not a field): use `DataTable` and `createKrizakaForm`.
   A search box or a one-field newsletter stays a plain form.

```js
krizakaStack({
  files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], // default
  ignores: ["packages/**"], // e.g. the facades of a monorepo
  severity: "warn", // default; "error" once the app's counts are at 0
  maxFormFields: 1, // default
});
```

### « Krizaka first » — the refused imports (dependency-cruiser)

Part of the stack ADR and of krizaka-ui#609, in **one tool**: dependency-cruiser carries every refused import (an import
is an edge: it catches re-exports and dynamic imports, and the same file holds the layers); ESLint keeps the framework
rules above. The ESLint rule `krizaka/no-direct-tanstack-import` is retired: `@tanstack/*` is `krizaka-first-query`.

The **covered-domains map** is `covered-domains.json`, the single source. Each domain names its Krizaka home and what is
refused in an app; the preset generates `krizaka-first-<domain>` from it, and the page « Use Krizaka first » of
ui.krizaka.com is laid out from it (`coveredDomainsMarkdown()`).

| Domain                                             | Krizaka home                                                                                                                   | Refused in an app                                                                                                              | Rule                  |
| :------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| Dates, times, local days                           | `@krizaka/intl` (formatting, `localDay`), `@krizaka/time` (arithmetic; a facade created on the first real need, krizaka-ts#76) | `date-fns*`, `@date-fns/*`, `dayjs`, `luxon`, `moment`, `moment-timezone`                                                      | `krizaka-first-dates` |
| Words, languages                                   | `@krizaka/i18n`                                                                                                                | `i18next*`, `react-i18next`, `next-intl`, `next-i18next`, `react-intl`, `@formatjs/*`, `@lingui/*`, `i18n-js`, `typesafe-i18n` | `krizaka-first-i18n`  |
| Data fetching, cache, tables, forms, virtual lists | `@krizaka/query`, `@krizaka/ui`, `@krizaka/pacer`                                                                              | `@tanstack/*`                                                                                                                  | `krizaka-first-query` |
| Icons                                              | `@krizaka/icons`                                                                                                               | `lucide-react`, `react-icons`, `@heroicons/*`                                                                                  | `krizaka-first-icons` |
| Interface primitives                               | `@krizaka/ui`                                                                                                                  | `@radix-ui/*`, `radix-ui`                                                                                                      | `krizaka-first-ui`    |

An entry is a package (`dayjs`, and its subpaths), a prefix (`date-fns*`) or a scope (`@tanstack/*`). It matches the
resolved file and the module as written when it cannot be resolved (a package the app does not declare), never a local
folder of the same name. **A Krizaka package is exempt: it is the facade.** In an app that is the packages in
`node_modules`; in a monorepo that holds its own Krizaka packages, say where they live:

```js
// .dependency-cruiser.cjs of a monorepo (krizaka-ui, krizaka-ts)
module.exports = require("@krizaka/config/dependency-cruiser").withOptions({ exemptFrom: ["(^|/)packages/"] });
```

Every message names the home and ends « Missing function? add it to the package first. » — a missing function is added
to the Krizaka package, never worked around with the library. Run it with `depcruise --output-type err-long <folders>`
to read the message (`err` prints the rule name only). Beside the domains, the preset owes every repository
`no-circular`, `not-to-unresolvable` (declare the dependency, or fix the path; set `options.tsConfig` for path aliases)
and `not-to-dev-dep` (tests, stories, scripts and tool configs may import devDependencies; a package that is also a `peerDependency` is installed by the consumer, so production code may import it). Run `depcruise` from the
workspace that owns the `package.json`.

#### Known violations (they only shrink)

An app that adopts the rules late records what it already breaks, and the debt only goes down:

```bash
krizaka-known-violations init src app         # once, in the adoption pull request: writes .dependency-cruiser-known-violations.json
depcruise src app --config .dependency-cruiser.cjs --ignore-known .dependency-cruiser-known-violations.json   # lint: new violations fail
krizaka-known-violations check src app        # lint: also fails on a recorded violation that is fixed ("lock the gain")
krizaka-known-violations update src app       # removes the fixed ones; NEVER adds one, and fails while a new one exists
```

The file is the format of `depcruise-baseline`, so `--ignore-known` reads it. `init` refuses to overwrite it; there is
no command that records a new violation. It replaces the `directTanstackImport` counter of `krizaka-ratchet`, which
stays only for repositories that have not moved yet.

`noLocaleTernary({ files, routing })`: `routing` lists the files allowed to compare locales (default: `proxy.ts`,
`middleware.ts`, `i18n.ts`, `seo.ts`, `app/[locale]/layout.tsx`, `I18nProvider.tsx`).

### Server/client boundary (`krizaka-server-client-boundary`)

A Next.js server module that calls a function exported by a `"use client"` module (`readFilterParams()` of
`@krizaka/ui/filter-bar`) crashes the page with React error #441. Unit tests ignore the directive and `next build` does not
see it. Every Next.js App Router app runs the guard in its lint:

```sh
krizaka-server-client-boundary                 # from the app's folder: reads app/ or src/app/ and the "@/*" alias of tsconfig.json
krizaka-server-client-boundary --root apps/web --app app --scope @krizaka
```

It walks the pages, layouts and routes, then every local module they import, and stops at a `"use client"` file. A lowercase
value import (a function, a hook, a constant) from a client module of the scope is an offence; components and `import type`
are fine. Render a component, or move the function to a plain module. `checkBoundary()` is also exported for a test.

### Environment variable names (`krizaka/env-name`)

Environment variables are named by bounded context (krizaka/.github#46): `<CONTEXT>_<THING>` with CONTEXT one of
`APP_` `DATABASE_` `AUTH_` `MEDIA_` `MAIL_` `PUSH_` `PAYMENTS_` `REALTIME_` `ABUSE_` `OBSERVABILITY_` `AI_` `OPERATOR_`.
The rule — on in `krizakaBase` and `krizakaNext` — refuses a name read through `process.env.X`, `process.env["X"]` or
`import.meta.env.X` that starts (after `NEXT_PUBLIC_`, `EXPO_PUBLIC_` or `VITE_`) with:

- a **product**: the organisation's name, the repository's own (the first word of its package.json name,
  `acme-monorepo` → `ACME_`), or one you name — a deployment already says which product it is;
- a **vendor** (`BUNNY_`, `MAILGUN_`, `RESEND_`, `STRIPE_`, `GOOGLE_`, `EXPO_`, `REDIS_`…): the vendor is a
  value (`MEDIA_STORAGE_PROVIDER=bunny`, `MAIL_PROVIDER=mailgun`) and its settings sit under the context
  (`MEDIA_STORAGE_API_KEY`, `MAIL_API_KEY`).

The platforms' own names (`GITHUB_TOKEN`, `EAS_BUILD`, …) pass. Tune it with
`envNames({ products, vendors, allow })` from `@krizaka/config/eslint/env-names`; `envNamePrefixProblem(name)` gives
the same verdict to a script (a `.env.example` or deployment spec check).

## The ratchet

A repository with debt cannot turn the rules on in one pull request. The ratchet lets it adopt them now: it counts
the four UI debts and the four stack debts, records the counts in `lint-ratchet.json` at the root, and **fails when a
count goes up**. Every migration pull request lowers them; when a count reaches zero, the matching rule becomes a
strict `error`.

```bash
npx krizaka-ratchet --init      # once: creates lint-ratchet.json with today's counts — commit it
npx krizaka-ratchet             # locally: compares (exit 1 when a count went up)
npx krizaka-ratchet --update    # after a migration: lowers the recorded counts (never raises them), records new counters — commit it
npx krizaka-ratchet --json      # in CI: the same check, machine-readable
```

| Counter                   | Pattern (same regex as the ESLint rule)                                                                                                                                                                                                                                      |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `palette`                 | `\b(bg\|text\|border\|from\|via\|to\|ring\|shadow\|fill\|stroke)-(zinc\|slate\|…\|indigo)-[0-9]`                                                                                                                                                                             |
| `light`                   | `\blight:`                                                                                                                                                                                                                                                                   |
| `arbitraryVar`            | `\[var\(--`                                                                                                                                                                                                                                                                  |
| `classNameTemplate`       | `` className=\{\s*` ``                                                                                                                                                                                                                                                       |
| `fetchInClientEffect`     | in a file opening with `"use client"`: `fetch(` / `krizakaFetch(` between the parentheses of a `useEffect(` / `useLayoutEffect(`                                                                                                                                             |
| `asyncInEffect`           | an effect (`useEffect(` / `useLayoutEffect(`, any file) whose callback awaits or calls `.then(`, `fetch(`, `invoke(`, `api.*`, `*Client.*`, and is not a subscribe-and-cleanup                                                                                               |
| `derivedStateInEffect`    | an effect whose only statements are `setX(…)` calls (optionally under `if`)                                                                                                                                                                                                  |
| `directTanstackImport`    | `from` / `import` / `import(` / `require(` of `"@tanstack/…"`                                                                                                                                                                                                                |
| `localTableOrForm`        | `<table`, and `<form` … `</form>` holding more fields than `maxFormFields` (default 1)                                                                                                                                                                                       |
| `retiredImport`           | an import of a dependency listed in `retire` (e.g. `["framer-motion"]`): the way out of a dependency                                                                                                                                                                         |
| `cognitiveComplexity`     | functions whose `sonarjs/cognitive-complexity` is above 15 (Sonar S3776), counted by running the rule on each source file of `stackGlobs`, tests excluded; the KPI of the cognitive debt, it only goes down                                                                  |
| `sonar`, `sonarjs/<rule>` | violations of the Sonar layer (the `eslint-plugin-sonarjs` recommended set, minus `SONAR_OFF` and cognitive complexity), tests excluded: a total, and one counter per rule with a violation (an absent rule is 0); the KPI of the Sonar-at-lint debt, it only goes down      |
| `routeStateSelection`     | a Tabs / chip group / choice grid / segmented switch (incl. `RadioGroup.Root variant="segmented"`) / toggle group of a view driven by local state (`value`, `defaultValue`, `onValueChange`) without `routeKey`, and without `// @ephemeral: <reason>`: the URL is the state |

The UI counters scan `app/**/*.tsx`, `components/**/*.tsx` and `src/**/*.tsx` by default (`node_modules`, `dist`,
`.next` never), or the globs given on the command line; the stack counters scan every source file (`js`, `jsx`, `mjs`,
`ts`, `tsx`, `mts`) of `app`, `components`, `src`, `lib`, `hooks` and `features` (`stackGlobs`). `--init` stores both
in the file so that every later run counts the same set. A file written before the stack counters still checks; the
next `--update` records them at their current value.
The counts apply the regex to the whole source text — a class held in a constant or a `cn()` argument counts too —
so the ratchet is never looser than the rule. Exit codes: `0` ok, `1` a count went up, `2` usage or file error.

```jsonc
// lint-ratchet.json
{
  "globs": ["app/**/*.tsx", "components/**/*.tsx", "src/**/*.tsx"],
  "stackGlobs": ["app/**/*.{js,jsx,mjs,ts,tsx,mts}", "…"],
  "allow": [], // optional: same families as krizakaUi({ allow })
  "retire": ["framer-motion"], // optional: dependencies on their way out
  "maxFormFields": 1, // optional: same option as krizakaStack({ maxFormFields })
  "counters": {
    "palette": 2400,
    "light": 1151,
    "arbitraryVar": 0,
    "classNameTemplate": 128,
    "fetchInClientEffect": 41,
    "directTanstackImport": 3,
    "localTableOrForm": 38,
    "retiredImport": 4,
  },
}
```

The CI step, after the install:

```yaml
- run: npx krizaka-ratchet --json
```

## License

[Apache-2.0](https://github.com/krizaka/krizaka-ts/blob/main/LICENSE)
