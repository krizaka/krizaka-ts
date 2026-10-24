# @krizaka/config — Package Contract (agent-neutral)

> Published on npm as **`@krizaka/config`**. Lives in `packages/config` of the krizaka-ts monorepo (moved from krizaka-ui: the quality kit is not UI): the root
> [`AGENTS.md`](../../AGENTS.md) applies first.

## 1. What belongs here

- The **configuration shared by every Krizaka JavaScript repository**: ESLint flat configs, tsconfig bases, Prettier,
  EditorConfig, and the `krizaka-ratchet` debt counter.
- The **non-negotiable UI rules** of the refactor (study §2.12), the **stack rules** of
  [ADR-001](https://github.com/krizaka/krizaka-ui/blob/main/docs/adr/ADR-001-tanstack-under-krizaka-facades.md) (no fetch in a client effect, no direct
  `@tanstack/*` import, no hand-written table or form) with the dependency-cruiser boundary, and the rule against
  locale ternaries. No product word:
  a product's specifics are options (`allow`, `files`, `routing`), never a branch in this package.

## 2. Rules

- **One definition of each pattern**: `patterns.js`. The ESLint rules (`eslint/krizaka-ui.js`, `eslint/rules.js`) and
  the ratchet (`ratchet/ratchet.js`) both read it — a pattern never diverges between the two.
- **One plugin object**: every `krizaka/*` rule lives in `eslint/plugin.js`; configs register that object, so they
  compose (flat config refuses two objects under one plugin name).
- `dependency-cruiser.cjs` is CommonJS (dependency-cruiser `require`s its configs) and holds only what every app shares;
  an app `extends` it and adds its own rules.
- Plain ESM JavaScript, no build: what is in the folder is what ships. Types are JSDoc, checked by `tsc --checkJs`.
- `eslint` ^9 and `typescript` ^5 are peer dependencies; `eslint-config-next` and `prettier` are optional peers.
  Plugins are dependencies.
- The ratchet never raises a recorded count: `--update` only lowers, and still fails on an increase.
- The package lints itself with its own configuration (`eslint.config.mjs`, relative imports); the other packages of krizaka-ts consume it from npm.

## 3. Quality gates

- `pnpm turbo run check --filter=@krizaka/config`: ESLint and type-check (`checkJs`), tests (Vitest: each UI rule,
  each stack rule, the locale rule, the base and Next configs, the tsconfig bases, the dependency-cruiser boundary on a
  fixture, the ratchet on fixtures and through its CLI), size, publint.
- **Size budget** (gzip): the ratchet (`bin` + `ratchet` + `patterns`) ≤ 8 kB.
- Published surface: the exports listed in `package.json` and the `krizaka-ratchet` bin. Removing an export, renaming
  a counter or tightening a rule's default is a breaking change (major); a new rule is at least a minor.

## 4. Release

A changeset for every change to a shipped file. `@krizaka/config` is **not** in the `fixed` group: it has its own
version (0.x while the adoption runs).
