---
"@krizaka/config": minor
---

« Krizaka first » (krizaka-ui#609, #612): the covered-domains map (`covered-domains.json`, dates, i18n, query, icons, ui: each names its Krizaka home and the refused imports) and the dependency-cruiser preset generated from it, one `krizaka-first-<domain>` rule per domain, with `no-circular`, `not-to-unresolvable` and `not-to-dev-dep`. The message names the Krizaka home and says « Missing function? add it to the package first. ». `.withOptions({ exemptFrom })` for a monorepo's own packages. New `krizaka-known-violations` (`init`, `check`, `update`): a known-violations baseline that only shrinks. New exports `@krizaka/config/covered-domains` and `/known-violations`; `dependency-cruiser` is now a dependency.

**Breaking:** the ESLint rule `krizaka/no-direct-tanstack-import` is retired (and leaves `STACK_RULES`): the TanStack import is `krizaka-first-query` in dependency-cruiser, one tool only. `krizaka-no-direct-tanstack` is replaced by it.
