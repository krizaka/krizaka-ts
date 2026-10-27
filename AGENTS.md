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
- **Imports**: dependency-cruiser with the shared preset of `@krizaka/config` (`.dependency-cruiser.cjs`, `pnpm run lint:deps`, one run per package): « Krizaka first » (dates go through `@krizaka/intl`), cycles, unresolvable imports, dev dependencies in production code, and `krizaka-ts-not-from-ui` (ADR-004): a package here never imports what renders (`@krizaka/ui`, tokens, fonts, icons, tailwind, charts, email). The violations that existed at adoption are recorded per package in `.dependency-cruiser-known-violations.json` and only go down: fix one, then `node scripts/deps.mjs update`; a new one is never recorded.
- **Issues first**: every change links its issue (`Refs #n`), with a proof in the PR.
- **Documentation site** (`site/`, ts.krizaka.com, krizaka/krizaka-ts#28): a static Next.js site on the Krizaka UI blocks, built like java.krizaka.com. One page per package, generated at build from `packages/*` (README, exports read from the TypeScript program, changelog) and the version npm lists — never hand-written, never a version typed. A new package needs its one line in `site/messages/{en,fr}.json` (`packages.<dir>`) and a line in the root README's table; `npm run lint` in `site/` fails otherwise. Deployed by DigitalOcean App Platform (`.do/app.yaml`) on every push to main; CI is `.github/workflows/site.yml`.

## Before you open or update a pull request (coding agents)

These are the defects code review found most often on 2026-10-23. Check them yourself before you open or update a pull request:
1. **Checks:** run the repository's full check (lint, typecheck, tests, build) and fix it. Never push a red check.
2. **Concurrency:** any « count then insert » or « check then write » runs in one transaction with a lock, and has a concurrency test.
3. **One gate:** a rule (limit, permission, validation) is enforced in the service, so no route can skip it. Test every route.
4. **Errors:** a cleanup (ROLLBACK, DROP, close) never masks the original error. Rethrow it, or throw an `AggregateError` with the original first.
5. **Validation:** validate the original input, never a truncated or pre-trimmed copy. Server and client reject the same inputs.
6. **Accessibility:**
   - every control has a unique label, and FR/EN pairs say their language;
   - focus rings are never clipped by `overflow`;
   - text never overflows its box at 360 px.
7. **Naming:** environment variables follow `<CONTEXT>_<THING>` (`APP_`, `DATABASE_`, `AUTH_`, `MEDIA_`, `MAIL_`, `PAYMENTS_`, `AI_`…) and are declared once.
8. **Words:** every user-facing string is in the FR and EN messages, and no colour is hard-coded.
9. **Review threads:** answer every one. Fix it test-first, or reply with the reason, then resolve it.

- **A bug means a missing guard** ([standard](https://github.com/krizaka/.github/blob/main/docs/standards/bug-means-missing-guard.md)): the fix PR first adds a guard that fails on `main`, then fixes the bug; the bug issue says why the guards missed it.

**Repository layout:** the root follows [krizaka/.github `docs/standards/repo-layout.md`](https://github.com/krizaka/.github/blob/main/docs/standards/repo-layout.md); the CI guard `check-repo-layout` fails on a stray root file, and a justified extra is declared in `.repo-layout.json` with its why.
