# @krizaka/architecture

## 0.3.1

### Patch Changes

- 79a6d53: SonarCloud smells cleared (second batch), behaviour unchanged: readonly sets, linear regular expressions, `replaceAll`, optional chains. The coverage reports now include the package's own `.js` / `.mjs` sources, and `@krizaka/org` keeps its default pictures and demo cast as JSON files. A contact e-mail address with an empty domain label (`a@b..c`) is no longer accepted by `@krizaka/coupons` and `@krizaka/mail`.

## 0.3.0

### Minor Changes

- ae9aa3e: `layoutViews(model, options)` and `krizaka-architecture layout`: check a LikeC4 model with the org's rules and lay its views out at build time (deterministic, with the sources' sha256 and the check's verdict), or lay out the containers view of a `buildC4` result. Exports the view types `ArchView`, `ArchNode`, `ArchEdge`, `Box`, `Point` and the typed `ArchitectureModelError`. New pinned dependency: `@likec4/language-services` 1.60.0.

## 0.2.1

### Patch Changes

- ae09f3f: yaml 2.8.3 (security advisories GHSA for yaml < 2.8.3)

## 0.2.0

### Minor Changes

- 5afd8cd: @krizaka/architecture 0.2.0: every container carries its version and the org dependencies that build it (the lockfile's version for npm, the pin otherwise; an imported BOM and the org parent for Maven), through `unitsOf(files)` for npm workspaces, the Maven reactor, crates and Python projects; `buildC4FromFiles(files, { name })` gives the same view as `buildC4(dir)` from a map of files (a tarball, a fixture). Every manifest is read with its parser (`yaml`, `smol-toml`, `fast-xml-parser`, pinned), so the package is no longer dependency-free and a POM description's entities are now decoded (`&amp;` → `&`). The three levels are otherwise unchanged (krizaka-internal#1920, ADR-027).

## 0.1.0

### Minor Changes

- 5bb3169: New package: the C4 view of a repository generated from its code (containers from the workspaces or Maven modules, components from the folders, the imports between them, external services from the env declarations), as JSON and text, with a `krizaka-architecture <repo> --out <file>` CLI that runs on a local checkout (krizaka/.github#371).
