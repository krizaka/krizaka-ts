---
"@krizaka/config": minor
---

`krizaka-edit-check` formats the edited file with the repository's Prettier (ts, tsx, js, jsx, mjs, cjs, json, css) before the ESLint check, when the repository has adopted it (the binary and a `prettier.config.*`). Silent: formatting is never a finding. Rule `formatter`, krizaka/.github#427.
