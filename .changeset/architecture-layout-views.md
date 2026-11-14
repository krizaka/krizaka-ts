---
"@krizaka/architecture": minor
---

`layoutViews(model, options)` and `krizaka-architecture layout`: check a LikeC4 model with the org's rules and lay its views out at build time (deterministic, with the sources' sha256 and the check's verdict), or lay out the containers view of a `buildC4` result. Exports the view types `ArchView`, `ArchNode`, `ArchEdge`, `Box`, `Point` and the typed `ArchitectureModelError`. New pinned dependency: `@likec4/language-services` 1.60.0.
