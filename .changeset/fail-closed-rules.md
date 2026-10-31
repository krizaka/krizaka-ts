---
"@krizaka/config": minor
---

Four fail-closed ast-grep rules in the `core` set: `no-fail-open-secret`, `no-bare-skip`, `no-unchecked-sent-log` and `no-swallowed-catch-success`, each with its rule tests. They read scripts, tools and tests (`.mjs` too). Refs krizaka-internal#1972.
