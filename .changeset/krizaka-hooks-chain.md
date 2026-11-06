---
"@krizaka/config": minor
---

New bin `krizaka-hooks`, the one git hook chain of every Krizaka repository (ADR-026). `krizaka-hooks install`, run by a repository's `prepare`, points `core.hooksPath` at three shims: pre-commit scans the staged diff with gitleaks, commit-msg checks the Co-authored-by trailers against the org's public allow-list, pre-push runs the repository's checks, declared in `package.json` under `krizaka.hooks` (default: its `precheck` script). Machine extensions in `~/.config/krizaka/hooks.d/<hook>/` run after the steps. Idempotent; a clone without the package still pushes (CI stays the last word).
