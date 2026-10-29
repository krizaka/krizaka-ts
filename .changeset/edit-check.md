---
"@krizaka/config": minor
---

`krizaka-edit-check <file>`, a bin for the coding agents' `PostToolUse` hook (ADR-015 §7): TypeScript runs the repository's ESLint on the one file, Java runs the pinned PMD (checksummed, cached once under `~/.cache/krizaka`) with the Krizaka rules, never Maven. Findings on stderr with exit 2; silent on a timeout (10 s budget) or when the tool is not there yet.
