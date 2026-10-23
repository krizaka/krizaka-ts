# Krizaka TS — agent contract

Krizaka TS is the TypeScript counterpart of Krizaka Java: backend building blocks shared by every Krizaka product, published on
npm under `@krizaka/` (Apache-2.0). ADR: krizaka/.github `docs/adr/ADR-006-krizaka-ts-organize.md`. Epic: krizaka/.github#183.

- **A package is generic**: no import from a product, no environment variable, no vendor SDK, no ambient clock (`Clock` injected),
  no database client (a `Query` function is passed in). Rules are data. Ports for everything else.
- **Names are functional**: a file says what it does (`accounts.ts`, `persistence.ts`, `db.ts`), never the technology behind it
  (`postgres.ts`, `pg-store.ts`, `mailgun.ts`); `scripts/check-file-names.mjs` (in `pnpm lint`) refuses it.
- **Tests first**, every package with unit tests and, where it stores, an integration test against PostgreSQL (CI's service;
  locally `ORGANIZE_DB_IT=1 DATABASE_URL=… pnpm test`). A store ships a contract kit every adapter runs.
- **Releases**: Changesets (`pnpm changeset`), the Release workflow opens « chore: version packages » and publishes with `NPM_TOKEN`.
- **Static rules**: ast-grep + ratchet (`pnpm lint`); the debt only goes down. Duplicated lines too (`dup-ratchet.json`).
- **Issues first**: every change links its issue (`Refs #n`), with a proof in the PR.
- **Documentation site** (`site/`, ts.krizaka.com, krizaka/krizaka-ts#28): a static Next.js site on the Krizaka UI blocks, built like java.krizaka.com. One page per package, generated at build from `packages/*` (README, exports read from the TypeScript program, changelog) and the version npm lists — never hand-written, never a version typed. A new package needs its one line in `site/messages/{en,fr}.json` (`packages.<dir>`) and a line in the root README's table; `npm run lint` in `site/` fails otherwise. Deployed by DigitalOcean App Platform (`.do/app.yaml`) on every push to main; CI is `.github/workflows/site.yml`.
