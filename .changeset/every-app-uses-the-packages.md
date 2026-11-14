---
"@krizaka/config": minor
"@krizaka/storage": patch
"@krizaka/page-audit": patch
---

Every app uses the `@krizaka` packages (krizaka-internal#3582). New `no-local-lib-copy` rule in an `app` set of the ast-grep pack: a function, class, type or `const` declared under a name a `@krizaka/*` package exports is refused (the names are generated from the packages' exports, `pnpm run gen:package-exports`; `// lib-allow: <reason>` for a port implementation). The « Krizaka first » dependency-cruiser preset now also generates `krizaka-first-<package>` rules from the libraries each package declares it wraps (`krizaka.facade` in its package.json, generated into `facades.json`): `@krizaka/storage` (`opendal`, `arctic`) and `@krizaka/page-audit` (`playwright-core`).
