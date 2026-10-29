---
"@krizaka/config": minor
---

`krizaka-edit-check` formats the edited file with the repository's Prettier (ts, tsx, js, jsx, mjs, cjs, json, css) before the ESLint check, when the repository has adopted it (the binary and a `prettier.config.*`). Silent: formatting is never a finding. Rule `formatter`, krizaka/.github#427.

The `typescript` peer range is `^5 || ^6`, so a repository on TypeScript 6 can install the package for its Prettier config alone (npm refused the install on `typescript@6`).
