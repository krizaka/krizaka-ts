---
"@krizaka/config": patch
---

The export guard reads every form of React flight reference in a page payload as a reference, not a price: a reference with a property path (`"$25:props:org:footer"`) and every prefix (`$L`, `$@`, `$F`, `$S`, `$D`, `$n`, `$Q`…), by a linear scan with no list of amounts; a visible amount or product licence line still fails.
