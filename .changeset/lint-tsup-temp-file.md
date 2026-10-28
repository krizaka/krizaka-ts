---
"@krizaka/config": patch
---

ESLint ignores the temporary `tsup.config.bundled_*` file tsup writes next to a build, so a lint running beside a build no longer crashes with ENOENT.
