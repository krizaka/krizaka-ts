---
"@krizaka/config": minor
---

Add `@krizaka/config/env-spec`: `checkEnvSpec` (the env schema against the deploy spec's `envs`, with a `notDeclared` map of key → reason) and `readAppSpecEnvs` (a DigitalOcean App spec file read into its `envs` per component), so no app keeps its own copy (krizaka-internal#3650).
