---
"@krizaka/architecture": minor
---

@krizaka/architecture 0.2.0: every container carries its version and the org dependencies that build it (the lockfile's version for npm, the pin otherwise; an imported BOM and the org parent for Maven), through `unitsOf(files)` for npm workspaces, the Maven reactor, crates and Python projects; `buildC4FromFiles(files, { name })` gives the same view as `buildC4(dir)` from a map of files (a tarball, a fixture). Every manifest is read with its parser (`yaml`, `smol-toml`, `fast-xml-parser`, pinned), so the package is no longer dependency-free and a POM description's entities are now decoded (`&amp;` → `&`). The three levels are otherwise unchanged (krizaka-internal#1920, ADR-027).
