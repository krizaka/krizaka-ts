---
"@krizaka/page-audit": minor
---

`controlOverlaps`: two interactive elements that share pixels on screen fail the audit (a control that cannot be clicked because another one covers it). Off by default; a page opts in with `controlOverlaps: true`.
