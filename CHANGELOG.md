# @krizaka/config

## 0.2.0

### Minor Changes

- [#109](https://github.com/krizaka/krizaka-ui/pull/109) [`406e62c`](https://github.com/krizaka/krizaka-ui/commit/406e62c102f913e2d121ff20f409d74ddd40dfda) Thanks [@oussamaABID](https://github.com/oussamaABID)! - The stack rules of ADR-001 (TanStack under `@krizaka/*` facades): `krizakaStack()` (`@krizaka/config/eslint/stack`)
  brings three warnings — `krizaka/no-fetch-in-client-effect` (a `fetch` / `krizakaFetch` in a `useEffect` of a
  `"use client"` file), `krizaka/no-direct-tanstack-import` (any `@tanstack/*` import outside a `@krizaka/*` package) and
  `krizaka/no-local-table-or-form` (a `<table>`, or a `<form>` of more than one field). `krizaka-ratchet` counts the same
  patterns (`fetchInClientEffect`, `directTanstackImport`, `localTableOrForm`) and the imports of the dependencies listed
  under `retire` (`retiredImport`); a `lint-ratchet.json` without them still checks, and `--update` records them. New
  `@krizaka/config/dependency-cruiser`: the shared boundary (`krizaka-no-direct-tanstack`) an app `extends`. Every
  `krizaka/*` rule now lives in one plugin object (`@krizaka/config/eslint/plugin`), so the configs compose.

## 0.1.0

### Minor Changes

- [#7](https://github.com/krizaka/krizaka-ui/pull/7) [`8446ac9`](https://github.com/krizaka/krizaka-ui/commit/8446ac93ec8e348b8130fa513a3cf0542fd723f0) Thanks [@oussamaABID](https://github.com/oussamaABID)! - Initial release: the shared configuration of every Krizaka JavaScript repository — ESLint flat configs (`krizakaBase`,
  `krizakaNext`, the four UI rules `krizakaUi(options?)` with a palette allowlist, `noLocaleTernary`), tsconfig bases
  (`base`, `react-library`, `next`, `react-native`), Prettier, EditorConfig, and `krizaka-ratchet`, the counter that fails
  when the UI debt goes up (`--init`, `--update`, `--json`).
