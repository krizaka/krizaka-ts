---
"@krizaka/config": minor
---

`krizakaStack()` enables the whole `eslint-plugin-sonarjs` recommended set (the engine of SonarCloud's JS/TS rules), so a Sonar finding fails at lint time (ADR-013, krizaka/.github#333, krizaka-ts#164). New option `sonar: "error" | "warn" | "off"` (default `"error"`; a repository with debt passes `"warn"`). Test files are not part of it. Fifteen rules that duplicate ESLint core, typescript-eslint, tsc or eslint-config-next are turned off explicitly with a reason (`SONAR_OFF`, `@krizaka/config/eslint/sonar`). `krizaka-ratchet` counts every rule: a `sonar` total plus one `sonarjs/<rule>` counter per rule with a violation; `--update` records them, a first violation of a rule that had none fails, `cognitive-complexity` keeps its own counter. Rules that need type information (S2871 `no-alphabetical-sort`, `deprecation`…) only fire when the lint runs with `projectService`.
