---
"@krizaka/page-audit": patch
---

`@krizaka/page-audit/visual`: a first-paint capture (JavaScript off) no longer hangs for the test timeout: `settleForShot` does not inject the freeze style (Playwright cannot run a script in such a page); `animations: "disabled"` still freezes CSS animations.
