# krizaka-ts — agent contract

<!-- krizaka-agents-template v2: rendered from krizaka/.github docs/standards/agents-template.md (scripts/agents-md.mjs). The one AGENTS.md standard: six sections in this order, at most 150 lines, bullets and imperatives. The conformance check « agents-template » reads the headings, the length and CLAUDE.md. Detail goes to docs/ via References, not here. -->

## Project context

- Krizaka TS is the TypeScript counterpart of Krizaka Java: backend building blocks shared by every Krizaka product, published on npm under `@krizaka/` (Apache-2.0).
- pnpm workspace (`packages/*`, `site/`), Node ≥ 22, built with turbo, tested with vitest. Registry entry: [repos.json](https://github.com/krizaka/.github/blob/main/repos.json).
- ADR: `krizaka-internal` docs/adr/.github/ADR-006-krizaka-ts-organize.md. Epic: krizaka/.github#183.
- Read this file first; the design notes and ADRs of this repository are in [docs/](docs/).
- `CLAUDE.md` is the one line `@AGENTS.md`: never a second copy of it.

## Essential commands

```bash
pnpm install --frozen-lockfile
pnpm run format          # prettier --write
pnpm run lint            # turbo lint, ast-grep, ratchet, file names, deps, lockfiles, workspace guard, format check
pnpm run typecheck
pnpm run test            # turbo test + vitest
pnpm run build
pnpm run check           # lint + typecheck + test: the pre-push hook runs it
pnpm run lint:deps       # dependency-cruiser, one run per package
pnpm changeset           # a release note for a package change
```

- A store's integration test: `ORGANIZE_DB_IT=1 DATABASE_URL=… pnpm test` (CI provides the PostgreSQL service).
- Site (`site/`): `npm run lint` in `site/`.
- Run them on what you changed before every push; CI runs the rest.

## Architecture & conventions

- Follow the [krizaka-engineering skill](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/SKILL.md); search its [packages reference](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/references/packages.md) before writing anything generic.
- A package is generic: no import from a product, no environment variable, no vendor SDK, no ambient clock (`Clock` injected), no database client (a `Query` function is passed in). Rules are data. Ports for everything else.
- Name files by what they do (`accounts.ts`, `persistence.ts`, `db.ts`), never by the technology (`postgres.ts`, `pg-store.ts`, `mailgun.ts`); `scripts/check-file-names.mjs` (in `pnpm lint`) refuses it. No `*Utils`, `*Helper`, `*Manager`.
- Write tests first: every package has unit tests and, where it stores, an integration test against PostgreSQL. A store ships a contract kit every adapter runs.
- Imports go through dependency-cruiser with the shared preset of `@krizaka/config` (`.dependency-cruiser.cjs`): « Krizaka first » (dates go through `@krizaka/intl`), no cycles, no unresolvable imports, no dev dependency in production code.
- `krizaka-ts-not-from-ui` (ADR-004): a package here never imports what renders (`@krizaka/ui`, tokens, fonts, icons, tailwind, charts, email).
- Violations that existed at adoption are in `.dependency-cruiser-known-violations.json` and only go down: fix one, then `node scripts/deps.mjs update`; never record a new one.
- Static rules are ast-grep plus a ratchet (`pnpm lint`); the debt only goes down. Duplicated lines too (`dup-ratchet.json`).
- A closed set is a type (`as const` object), never a string compared by hand (`no-enum-string-compare`). Use `?.` and `??`, not a chain of `&&` or a ternary on null.
- Releases: Changesets; the Release workflow opens « chore: version packages » and publishes with `NPM_TOKEN`.
- Documentation site (`site/`, ts.krizaka.com, krizaka/krizaka-ts#28): static Next.js on the Krizaka UI blocks, one page per package generated at build from `packages/*` (README, exports from the TypeScript program, changelog) and the version npm lists — never hand-written, never a version typed. Deployed by DigitalOcean App Platform (`.do/app.yaml`) on every push to main; CI is `.github/workflows/site.yml`.
- A new package needs its line in `site/messages/{en,fr}.json` (`packages.<dir>`) and a line in the root README's table; `npm run lint` in `site/` fails otherwise.
- The root layout follows [repo-layout](https://github.com/krizaka/.github/blob/main/docs/standards/repo-layout.md); the CI guard `check-repo-layout` fails on a stray root file; declare a justified extra in `.repo-layout.json` with its why.

## Guard-rails & known pitfalls (read before coding)

- The checks are the judge ([ADR-015](https://github.com/krizaka/krizaka-internal/blob/main/docs/adr/.github/ADR-015-ai-code-audit-measured-and-enforced.md), [guards](https://github.com/krizaka/.github/blob/main/docs/standards/guards.md)): never `--no-verify`, never a new `eslint-disable`, never a raised ratchet or baseline; a rule is never silenced to get green.
- Concurrency: run any « count then insert » or « check then write » in one transaction with a lock, and add a concurrency test.
- One gate: enforce a rule (limit, permission, validation) in the service so no route can skip it; test every route.
- Errors: a cleanup (ROLLBACK, DROP, close) never masks the original error; rethrow it, or throw an `AggregateError` with the original first.
- Validation: validate the original input, never a truncated or pre-trimmed copy; server and client reject the same inputs.
- Accessibility: every control has a unique label, FR/EN pairs say their language, focus rings are never clipped by `overflow`, text never overflows its box at 360 px.
- Naming: environment variables follow `<CONTEXT>_<THING>` (`APP_`, `DATABASE_`, `AUTH_`, `MEDIA_`, `MAIL_`, `PAYMENTS_`, `AI_`…) and are declared once.
- Words: every user-facing string is in the FR and EN messages, and no colour is hard-coded.
- A bug means a missing guard ([standard](https://github.com/krizaka/.github/blob/main/docs/standards/bug-means-missing-guard.md)): the fix PR first adds a guard that fails on `main`, then fixes the bug; the bug issue says why the guards missed it.
- A stale install or a `*.tsbuildinfo` written against other dependencies makes typecheck fail on a clean main: the pre-push hook reinstalls from the lockfile; do the same by hand.
- Never invent a URL, a law article, a price or a figure you did not read; write `TO VALIDATE` and say who decides.
- Never commit a secret, a capture or a log; no production data in a session, only the dev data.
- Keep the edit hook in `.claude/settings.json`: `krizaka-edit-check` on `Edit|Write` checks the one file with ESLint in under 10 s; a finding comes back to you.

## Expected validation workflow

- [ ] Run `pnpm run check` (lint, typecheck, tests) and `pnpm run build`; fix the cause of a red, never the guard.
- [ ] Run the PostgreSQL integration tests locally once when a store or migration changed (« skipped » is not green).
- [ ] Add a changeset when a package's published behaviour changes.
- [ ] Update the README table and `site/messages/{en,fr}.json` for a new package.
- [ ] Link the issue (`Refs #n`) with a proof in the PR; answer every review thread, test-first or with the reason, then resolve it.
- [ ] One issue, one small PR; merge only with green CI, through the merge queue (`ci.yml` and `security.yml` run on `merge_group`, with the SonarCloud CI analysis).

## References

- [docs/](docs/): ADRs and design notes of this repository.
- [Org standards](https://github.com/krizaka/.github/tree/main/docs/standards) of krizaka/.github; the [engineering charter](https://github.com/krizaka/.github/blob/main/AGENTS.template.md).
- [krizaka-engineering skill](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/SKILL.md).
