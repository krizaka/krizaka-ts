# @krizaka/config

## 0.5.0

### Minor Changes

- [#486](https://github.com/krizaka/krizaka-ui/pull/486) [`0b1d80d`](https://github.com/krizaka/krizaka-ui/commit/0b1d80dfe9fc742e902ce64916efda27f52e9505) Thanks [@krizaka-agents](https://github.com/apps/krizaka-agents)! - No more family switcher: krizaka.com is the only way back between the Krizaka sites (Oussama, 2026-10-22).
  
  - `NavBar.Family` is deprecated (removed in the next minor once no site uses it).
  - `SiteFooter` lists the family on the hub only: `family` now defaults to `current === "krizaka"`, so every other site's footer holds its own columns, the legal links and one quiet « A Krizaka project » line linking to www.krizaka.com. New `products` prop filters the hub's Products column (krizaka.com's focus products), replacing CSS that hid links by URL.
  - `@krizaka/config`: the `krizaka/no-family-switcher` rule (an error in `krizakaStack()`) refuses `NavBar.Family` so it does not come back.

## 0.4.2

### Patch Changes

- [#467](https://github.com/krizaka/krizaka-ui/pull/467) [`af54020`](https://github.com/krizaka/krizaka-ui/commit/af540209449168c5ff64e12b609909e94b23ba0a) Thanks [@krizaka-agents](https://github.com/apps/krizaka-agents)! - Vercel is retired: its platform variable names are no longer allowed by the env-name rule (a `VERCEL_` variable is refused like any vendor name).

## 0.4.1

### Patch Changes

- [#179](https://github.com/krizaka/krizaka-ui/pull/179) [`e3bcc51`](https://github.com/krizaka/krizaka-ui/commit/e3bcc51692773c3cea99ec6198cd0011f026a70e) Thanks [@oussamaABID](https://github.com/oussamaABID)! - The documentation moved to **https://ui.krizaka.com**, built from this repository (`apps/site`) at every change: the
  packages' `homepage` (what npm shows) and READMEs point there — `@krizaka/tokens` to /foundations/tokens, `@krizaka/icons`
  to /foundations/icons, `@krizaka/fonts` to /foundations/typography, the packages without UI to /packages/<name>.

## 0.4.0

### Minor Changes

- [#169](https://github.com/krizaka/krizaka-ui/pull/169) [`c08ae66`](https://github.com/krizaka/krizaka-ui/commit/c08ae666adba7bcf4bbda889266d79e5e40c3e22) Thanks [@oussamaABID](https://github.com/oussamaABID)! - Two named ESLint rules for the adoption: `krizaka/no-light-variant` (refuse Tailwind `light:` in products — tokens do the theming) and `krizaka/no-raw-palette` (refuse `bg-zinc-900`, `text-violet-400`… — use a role; `allow` families for isolated cases), registered on the `krizaka` plugin and shipped as warnings by `krizakaUiWarnings()` (`@krizaka/config/eslint/ui-warnings`). `krizaka-ratchet` already counts the same patterns (`light`, `palette`): a product adopts the warnings now and brings both counts to 0. `krizakaUi()` stays the strict set.

## 0.3.1

### Patch Changes

- [#143](https://github.com/krizaka/krizaka-ui/pull/143) [`d0e43fd`](https://github.com/krizaka/krizaka-ui/commit/d0e43fd7defaba8be14d61c3b84799fec817dad5) Thanks [@oussamaABID](https://github.com/oussamaABID)! - Package homepage points to the documentation on krizaka.com (the page the npm listing links to is the one that explains the package).

## 0.3.0

### Minor Changes

- [#129](https://github.com/krizaka/krizaka-ui/pull/129) [`86484f5`](https://github.com/krizaka/krizaka-ui/commit/86484f5bc240417536e4349a9a95d2c24a674b59) Thanks [@oussamaABID](https://github.com/oussamaABID)! - `krizaka/env-name`: environment variables are named by bounded context (krizaka/.github#46) — `<CONTEXT>_<THING>`, never after a product (the organisation's, the repository's own read from its package.json, or one a config names) nor a vendor (`BUNNY_`, `MAILGUN_`, `GOOGLE_`, `EXPO_`…: a vendor is a value, `MAIL_PROVIDER=mailgun`). It reads `process.env.X`, `process.env["X"]` and `import.meta.env.X`, sees through `NEXT_PUBLIC_` / `EXPO_PUBLIC_` / `VITE_`, lets the platforms' own names through (`GITHUB_TOKEN`, `VERCEL_URL`, `EAS_BUILD`…), and is on in `krizakaBase` and `krizakaNext`; `envNames({ products, vendors, allow })` (`@krizaka/config/eslint/env-names`) tunes it. `@krizaka/realtime`'s error and docs name `REALTIME_REDIS_URL`, `@krizaka/push`'s docs `PUSH_ACCESS_TOKEN`.

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
