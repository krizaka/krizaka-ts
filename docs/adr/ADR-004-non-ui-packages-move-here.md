# ADR-004: The non-UI packages move to krizaka-ts, `@krizaka/intl` first

- **Status:** accepted (2026-10-26) as the boundary and the order. The cut itself (one pull request per package, in two repositories) is separate work, filed package by package.
- **Issue:** krizaka/krizaka-ts#76. It follows krizaka-ui#610 (`localDay` in `@krizaka/intl`) and krizaka-ui#612 (`@krizaka/config` moved here, done).
- **Builds on:** [ADR-001](ADR-001-modular-architecture.md) §5 (where server packages live), krizaka/.github ADR-006.

## Context

Oussama, on `localDay` added to `@krizaka/intl` in krizaka-ui: « the side without UI, Krizaka TypeScript, is where this logic belongs; it does not depend on the UI ». A date, a sum of money or a plural is needed by a server, a worker or a CLI as much as by a screen. Today:

- `@krizaka/intl` lives in the UI repository. krizaka-ts re-implemented the same date logic privately (`brief/src/week.ts`, with its own `Intl.DateTimeFormat`).
- Server packages sit in krizaka-ui (`payments`, `push`, `realtime`), next to packages that render.
- krizaka-ts is already « the TypeScript kit for every repository, like krizaka-build for Java »: `@krizaka/config` (ESLint `krizakaStack()`, the dependency-cruiser preset, the ratchet, the ast-grep pack) moved here first.

## Decision

### 1. The boundary

- **krizaka-ui holds what renders and what is design:** components and blocks, tokens, fonts, icons, the tailwind preset, charts, React Email templates, and the React facades over a third-party UI library (`query`).
- **krizaka-ts holds what runs anywhere without drawing anything:** a server, a worker, a CLI, a mobile or desktop client's logic. A package may offer a `./react` subpath of **hooks or a provider** if `react` is an **optional peer** and the subpath imports nothing from `@krizaka/ui`, `tokens`, `fonts`, `icons` or `tailwind`. That is a binding, not a design.
- **The dependency goes one way.** A krizaka-ui package may depend on a krizaka-ts package, never the reverse. krizaka-ts enforces it with a dependency-cruiser rule (`not-from-ui`, in `.dependency-cruiser.cjs`): no import of `@krizaka/ui`, `tokens`, `fonts`, `icons`, `tailwind`, `charts`, `email`.

### 2. Every package of krizaka-ui, classified

| Package | Decision | Why |
|---|---|---|
| `config` | **moved** (krizaka-ui#612) | ESLint, depcruise, ratchet and ast-grep are tooling for every repository |
| `intl` | **move**, first | zero dependency; money, numbers, dates, plurals, `localDay` |
| `payments` | **move** (with krizaka/krizaka-ts#34) | no UI; the module map's payments module |
| `push` | **move** | the Expo Push relay, one HTTP call |
| `realtime` | **move** | bus, presence, SSE framing, pg and Redis adapters |
| `app-config` | **move whole** | contract, server and client are pure; `./react` is a thin hook with an optional `react` peer |
| `discovery` | **move whole** | signed manifest, verification, cache; `./react` is a thin hook |
| `pacer` | **move whole** | debounce, throttle, queue, client rate limiter; `./react` are hooks |
| `i18n` | **move whole** | the engine (`format`, check, scan, CLI) is pure; `./react` and `./rich` are a provider and `<b>`/`<a>` markup with an optional `react` peer. Splitting it would force a second npm name on every consumer, against rule 3 below |
| `app-client` | stays for now | the Expo shell's bearer session, API client and React hooks. It moves when it stops being Expo-specific, as a separate decision |
| `app-desktop` | stays | depends on `app-client` (Tauri side) |
| `query` | stays | a React facade over TanStack Query |
| `email` | stays | React Email templates themed by `tokens` (ADR-001 §5: the `mail` module adds persistence and providers here) |
| `charts`, `ui`, `tokens`, `fonts`, `icons`, `tailwind` | stay | they render, or are design |

The order is by value and by risk: `intl` (the trigger, and `i18n` depends on it), then `payments` (inside its own module issue), `push`, `realtime`, `app-config`, `discovery`, `pacer`, then `i18n`.

### 3. Nothing changes for consumers

- **The npm names and the version line stay** (`@krizaka/intl` keeps counting from its last version, no reset).
- **The history is kept**: `git filter-repo --path packages/<name>` on a fresh clone, merged into krizaka-ts with its history (`git merge --allow-unrelated-histories` on a branch, then a squash is **not** used for this merge).
- **Publishing moves with the package**: the npm trusted publisher (GitHub Actions provenance) of the package is re-pointed from krizaka-ui's release workflow to krizaka-ts's, before the first release from here. The first release from krizaka-ts is a patch with the moved code unchanged, so the provenance attestation changes and nothing else.
- **The old folder is deleted in the same release train**: krizaka-ui's pull request removes `packages/<name>` and makes its own packages depend on the npm version, in the same hour as the first publish from here. Between the two, nothing is published from both.
- **Registration** is the usual one: a line in the root `README.md` table and `site/messages/{en,fr}.json` (`packages.<dir>`).

### 4. The first cut: `@krizaka/intl`

1. Move it with its history, tests and README. Add `localDay` if the copy here is behind.
2. `brief/src/week.ts` drops its private `Intl.DateTimeFormat` for `localDay` (krizaka-ts#77, which only needs the published package).
3. krizaka-ui deletes `packages/intl`, `charts` and `i18n` keep depending on the npm name.
4. The « Krizaka first » map (krizaka-ui#609) points `intl` to krizaka-ts.

## Consequences

- One home for the logic a server and a screen share, with the rule enforced by a tool, not a review.
- Two repositories release in a window for each moved package; the window is one hour and the steps are written above.
- krizaka-ts grows from backend modules to a general kit; its site (ts.krizaka.com) lists every moved package like the others, from its own README.

## Rejected

| Option | Why not |
|---|---|
| Split `i18n` and `app-config` into a core here and a React binding there | One npm name cannot span two repositories; a second name (`-react`) would change every consumer and import. The optional-peer binding keeps one package and still respects the one-way dependency. |
| Leave everything in krizaka-ui and import it from krizaka-ts | The reverse dependency: a server package would install the UI repository's release train and its React peers. |
| Reset versions on the move | Breaks `^` ranges and the provenance story for nothing. |
