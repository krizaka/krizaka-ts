---
"@krizaka/config": minor
---

Sonar's cognitive complexity (S3776, threshold 15) at lint time: `krizakaStack()` adds `sonarjs/cognitive-complexity` (error by default, `complexity: "warn"` for a repository with debt) and `krizaka-ratchet` a `cognitiveComplexity` counter that freezes existing violations and fails any increase (krizaka/.github#319).
