# Krizaka TS

TypeScript backend building blocks for every Krizaka product, like [Krizaka Java](https://java.krizaka.com): one implementation, no
copies. Published on npm under `@krizaka/` (Apache-2.0).

| Package | What it is | npm |
| --- | --- | --- |
| [`@krizaka/db`](packages/db#readme) | The database foundation: shared types, transactions, module schemas embedded in the product's migrations, a test database | [![npm](https://img.shields.io/npm/v/@krizaka/db?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/db) |
| [`@krizaka/auth`](packages/auth#readme) | Accounts and roles: profile, language, theme, avatar, e-mail change by link, password, sessions, export, deletion; roles and invitations as data | [![npm](https://img.shields.io/npm/v/@krizaka/auth?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/auth) |
| [`@krizaka/settings`](packages/settings#readme) | Configuration as data: a typed registry resolved user > workspace > global > default, every change audited | [![npm](https://img.shields.io/npm/v/@krizaka/settings?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/settings) |
| [`@krizaka/api-keys`](packages/api-keys#readme) | API keys: created, rotated, revoked and authenticated behind a store port | [![npm](https://img.shields.io/npm/v/@krizaka/api-keys?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/api-keys) |
| [`@krizaka/webhooks`](packages/webhooks#readme) | Signed, idempotent webhooks, both ways | [![npm](https://img.shields.io/npm/v/@krizaka/webhooks?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/webhooks) |
| [`@krizaka/organize`](packages/organize#readme) | A name, an avatar, tags and collections for any entity, with a conformance kit | [![npm](https://img.shields.io/npm/v/@krizaka/organize?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/organize) |
| [`@krizaka/brief`](packages/brief#readme) | The weekly brief: figured recommendations, each with one action; guards, ranking, the week in the shop's time zone | [![npm](https://img.shields.io/npm/v/@krizaka/brief?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/brief) |

**Documentation**: [ts.krizaka.com](https://ts.krizaka.com) is the docs home — one page per package, generated from each package's README, its exports and its changelog, with the version npm lists (nothing typed by hand). A package's README stays its source: install, API, examples; the products using it are
Akinaza and Yomizaka. The site, [ts.krizaka.com](https://ts.krizaka.com) (like java.krizaka.com), is generated from these files by `site/` at every change.

Decision: [ADR-006](https://github.com/krizaka/.github/blob/main/docs/adr/ADR-006-krizaka-ts-organize.md). Contract for contributors and agents: [AGENTS.md](AGENTS.md).

```bash
pnpm install
pnpm run check      # lint · typecheck · tests
```
