# Krizaka TS

[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=krizaka_krizaka-ts&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=krizaka_krizaka-ts) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=krizaka_krizaka-ts&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=krizaka_krizaka-ts) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=krizaka_krizaka-ts&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=krizaka_krizaka-ts) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=krizaka_krizaka-ts&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=krizaka_krizaka-ts) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=krizaka_krizaka-ts&metric=coverage)](https://sonarcloud.io/summary/new_code?id=krizaka_krizaka-ts)

TypeScript backend building blocks for every Krizaka product, like [Krizaka Java](https://java.krizaka.com): one implementation, no
copies. Published on npm under `@krizaka/` (Apache-2.0).

| Package | What it is | npm |
| --- | --- | --- |
| [`@krizaka/db`](packages/db#readme) | The database foundation: shared types, transactions, module schemas embedded in the product's migrations, a test database | [![npm](https://img.shields.io/npm/v/@krizaka/db?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/db) |
| [`@krizaka/time`](packages/time#readme) | Date arithmetic on an instant, exact in any time zone: the facade the « Krizaka first » dates rule points to | [![npm](https://img.shields.io/npm/v/@krizaka/time?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/time) |
| [`@krizaka/audit`](packages/audit#readme) | Who did what: an append-only trail in its own schema, inside the caller's transaction or beside it, filtered, exported and redacted for Loi 25 | [![npm](https://img.shields.io/npm/v/@krizaka/audit?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/audit) |
| [`@krizaka/outbox`](packages/outbox#readme) | The transactional outbox: events written in the caller's transaction, delivered at least once by leased workers, with retries, dead letters and an idempotent-consumer helper | [![npm](https://img.shields.io/npm/v/@krizaka/outbox?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/outbox) |
| [`@krizaka/privacy`](packages/privacy#readme) | Privacy (Loi 25): consents by purpose written once, export and erasure assembled from every module, retention per purpose | [![npm](https://img.shields.io/npm/v/@krizaka/privacy?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/privacy) |
| [`@krizaka/rate-limit`](packages/rate-limit#readme) | Limits per action: fixed windows per address and subject, the limits from the admin's settings, memory and PostgreSQL stores that count exactly under concurrency | [![npm](https://img.shields.io/npm/v/@krizaka/rate-limit?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/rate-limit) |
| [`@krizaka/auth`](packages/auth#readme) | Accounts and roles: profile, language, theme, avatar, e-mail change by link, password, sessions, export, deletion; roles and invitations as data | [![npm](https://img.shields.io/npm/v/@krizaka/auth?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/auth) |
| [`@krizaka/settings`](packages/settings#readme) | Configuration as data: a typed registry resolved user > workspace > global > default, and the price catalogue (dated versions); every change audited | [![npm](https://img.shields.io/npm/v/@krizaka/settings?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/settings) |
| [`@krizaka/api-keys`](packages/api-keys#readme) | API keys: created, rotated, revoked and authenticated behind a store port | [![npm](https://img.shields.io/npm/v/@krizaka/api-keys?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/api-keys) |
| [`@krizaka/orazaka-client`](packages/orazaka-client#readme) | One Orazaka client for the TypeScript products: start a run, read its status and outputs, typed errors, timeout and circuit breaker | [![npm](https://img.shields.io/npm/v/@krizaka/orazaka-client?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/orazaka-client) |
| [`@krizaka/webhooks`](packages/webhooks#readme) | Signed, idempotent webhooks, both ways | [![npm](https://img.shields.io/npm/v/@krizaka/webhooks?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/webhooks) |
| [`@krizaka/organize`](packages/organize#readme) | A name, an avatar, tags and collections for any entity; the workspace organised (tags with markers, status sets, saved views, bulk actions, ADR-003), with conformance kits | [![npm](https://img.shields.io/npm/v/@krizaka/organize?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/organize) |
| [`@krizaka/brief`](packages/brief#readme) | The weekly brief: figured recommendations, each with one action; guards, ranking, the week in the shop's time zone | [![npm](https://img.shields.io/npm/v/@krizaka/brief?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/brief) |
| [`@krizaka/org`](packages/org#readme) | The public facts about Krizaka in one validated JSON (legal identity, marks, live products, sites, footer line) published on the CDN, and the mobile apps' public runtime config | [![npm](https://img.shields.io/npm/v/@krizaka/org?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/org) |
| [`@krizaka/config`](packages/config#readme) | The quality kit of every TypeScript repository: ESLint flat configs, the dependency-cruiser preset, tsconfig bases, Prettier and the ratchet that keeps debts from coming back | [![npm](https://img.shields.io/npm/v/@krizaka/config?label=&color=3e76a8&logo=npm)](https://www.npmjs.com/package/@krizaka/config) |

**Documentation**: [ts.krizaka.com](https://ts.krizaka.com) is the docs home — one page per package, generated from each package's README, its exports and its changelog, with the version npm lists (nothing typed by hand). A package's README stays its source: install, API, examples; the products using it are
Akinaza and Yomizaka. The site, [ts.krizaka.com](https://ts.krizaka.com) (like java.krizaka.com), is generated from these files by `site/` at every change.

Decision: [ADR-006](https://github.com/krizaka/.github/blob/main/docs/adr/ADR-006-krizaka-ts-organize.md). Contract for contributors and agents: [AGENTS.md](AGENTS.md).

```bash
pnpm install
pnpm run check      # lint · typecheck · tests
```
