---
"@krizaka/config": patch
---

Fixes the broken 0.9.0 (published from the stale copy in krizaka-ui, without `krizaka-known-violations` and the
covered-domains and dependency-cruiser presets). krizaka-ts is the single source of `@krizaka/config`: the React-effects
rules of krizaka-ui#767 are ported here. `krizakaStack()` gains `krizaka/no-async-in-effect` and
`krizaka/no-derived-state-in-effect` (errors by default, `effects: "warn"` while a repository has debt), and
`krizaka-ratchet` counts them (`asyncInEffect`, `derivedStateInEffect`). Use `>=0.9.1`.
