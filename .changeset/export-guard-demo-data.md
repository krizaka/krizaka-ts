---
"@krizaka/config": patch
---

The export guard skips the amounts inside an element marked `data-demo` whose subtree shows a visible « exemple » / « example » label, in the HTML and in the React flight payloads, by a linear scan with no allow-list of amounts. The same amount outside fails, and a `data-demo` subtree without the label fails (`demo-label`) and keeps its amounts as findings.
