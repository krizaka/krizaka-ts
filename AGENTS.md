# Krizaka TS — agent contract

Krizaka TS is the TypeScript counterpart of Krizaka Java: backend building blocks shared by every Krizaka product, published on
npm under `@krizaka/` (Apache-2.0). ADR: krizaka/.github `docs/adr/ADR-006-krizaka-ts-organize.md`. Epic: krizaka/.github#183.

- **A package is generic**: no import from a product, no environment variable, no vendor SDK, no ambient clock (`Clock` injected),
  no database client (a `Query` function is passed in). Rules are data. Ports for everything else.
- **Tests first**, every package with unit tests and, where it stores, an integration test against PostgreSQL (CI's service;
  locally `ORGANIZE_DB_IT=1 DATABASE_URL=… pnpm test`). A store ships a contract kit every adapter runs.
- **Releases**: Changesets (`pnpm changeset`), the Release workflow opens « chore: version packages » and publishes with `NPM_TOKEN`.
- **Static rules**: ast-grep + ratchet (`pnpm lint`); the debt only goes down. Duplicated lines too (`dup-ratchet.json`).
- **Issues first**: every change links its issue (`Refs #n`), with a proof in the PR.
