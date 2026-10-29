---
"@krizaka/config": minor
---

`krizaka-workspace-guard`: a bin that fails when a package of a pnpm workspace depends on another package of the same workspace through a registry range instead of `workspace:` (the guard that lived in krizaka-ts `scripts/workspace-ranges.test.mjs`, extracted for every pnpm workspace; krizaka/.github#388).
