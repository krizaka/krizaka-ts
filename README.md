# @krizaka/config

**The shared configuration of every Krizaka JavaScript repository.** ESLint flat configs (base, Next.js, the four UI
rules, no locale ternary), tsconfig bases, Prettier, EditorConfig — and `krizaka-ratchet`, the counter that keeps the
UI debt from coming back.

[![npm](https://img.shields.io/npm/v/@krizaka/config?color=3b82f6&label=npm)](https://www.npmjs.com/package/@krizaka/config)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](../../LICENSE)

## Adopt it in three lines

```bash
npm install -D @krizaka/config eslint typescript     # + eslint-config-next for a Next.js app, prettier if you format
```

```js
// eslint.config.mjs — a Next.js app (a library: `krizakaBase` from "@krizaka/config/eslint")
import { krizakaNext } from "@krizaka/config/eslint/next";
import { krizakaUi } from "@krizaka/config/eslint/krizaka-ui";
import { noLocaleTernary } from "@krizaka/config/eslint/no-locale-ternary";

export default [...krizakaNext, ...krizakaUi(), ...noLocaleTernary()];
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

| Export | What it gives |
| :-- | :-- |
| `@krizaka/config/eslint` | `krizakaBase`: `@eslint/js` + `typescript-eslint` recommended, React hooks, import ordering (a warning, autofixable), ignores of generated output, `_`-prefixed unused arguments allowed. |
| `@krizaka/config/eslint/next` | `krizakaNext`: `eslint-config-next` (core web vitals + TypeScript, which already carry typescript-eslint, React hooks and import) + the same basics. |
| `@krizaka/config/eslint/krizaka-ui` | `krizakaUi(options?)`: the four UI rules below. Also `krizakaUiRules` and `krizakaUiRestrictedSyntax(options?)`. |
| `@krizaka/config/eslint/no-locale-ternary` | `noLocaleTernary(options?)`: `krizaka/no-locale-ternary` — no `locale === "fr" ? … : …` outside routing code. |
| `@krizaka/config/tsconfig/*.json` | `base` (strict, ES2022, bundler resolution), `react-library` (+ DOM, `react-jsx`), `next` (+ the Next plugin, `noEmit`, `incremental`), `react-native` (`jsx: react-native`, `customConditions`; with Expo: `"extends": ["expo/tsconfig.base", "@krizaka/config/tsconfig/react-native.json"]`). |
| `@krizaka/config/prettier` · `.editorconfig` | The formatting. |
| `krizaka-ratchet` (bin) | The debt counter, see below. |

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
  allow: ["emerald"],             // palette families tolerated for documented, isolated cases
  files: ["**/*.{jsx,tsx}"],      // default
  ignores: ["app/og/**"],         // e.g. generated OG images
  severity: "error",              // "warn" while the ratchet brings the debt down
});
```

Flat config replaces a rule's options instead of concatenating them: a repository that already sets
`no-restricted-syntax` merges both lists with `krizakaUiRestrictedSyntax()`. `no-locale-ternary` is a plugin rule for
that reason — it composes with anything.

`noLocaleTernary({ files, routing })`: `routing` lists the files allowed to compare locales (default: `proxy.ts`,
`middleware.ts`, `i18n.ts`, `seo.ts`, `app/[locale]/layout.tsx`, `I18nProvider.tsx`).

## The ratchet

A repository with debt cannot turn the UI rules on in one pull request. The ratchet lets it adopt them now: it counts
the four debts, records the counts in `lint-ratchet.json` at the root, and **fails when a count goes up**. Every
migration pull request lowers them; when a count reaches zero, the matching rule becomes a strict `error`.

```bash
npx krizaka-ratchet --init      # once: creates lint-ratchet.json with today's counts — commit it
npx krizaka-ratchet             # locally: compares (exit 1 when a count went up)
npx krizaka-ratchet --update    # after a migration: lowers the recorded counts (never raises them) — commit it
npx krizaka-ratchet --json      # in CI: the same check, machine-readable
```

| Counter | Pattern (same regex as the ESLint rule) |
| :-- | :-- |
| `palette` | `\b(bg\|text\|border\|from\|via\|to\|ring\|shadow\|fill\|stroke)-(zinc\|slate\|…\|indigo)-[0-9]` |
| `light` | `\blight:` |
| `arbitraryVar` | `\[var\(--` |
| `classNameTemplate` | `` className=\{\s*` `` |

It scans `app/**/*.tsx`, `components/**/*.tsx` and `src/**/*.tsx` by default (`node_modules`, `dist`, `.next` never),
or the globs given on the command line; `--init` stores them in the file so that every later run counts the same set.
The counts apply the regex to the whole source text — a class held in a constant or a `cn()` argument counts too —
so the ratchet is never looser than the rule. Exit codes: `0` ok, `1` a count went up, `2` usage or file error.

```jsonc
// lint-ratchet.json
{
  "globs": ["app/**/*.tsx", "components/**/*.tsx", "src/**/*.tsx"],
  "allow": [],                                   // optional: same families as krizakaUi({ allow })
  "counters": { "palette": 2400, "light": 1151, "arbitraryVar": 0, "classNameTemplate": 128 }
}
```

The CI step, after the install:

```yaml
- run: npx krizaka-ratchet --json
```

## License

[Apache-2.0](../../LICENSE)
