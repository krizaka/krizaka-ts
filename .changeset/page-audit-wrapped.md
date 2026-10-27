---
"@krizaka/page-audit": patch
---

A token in a table cell is not « wrapped one character per line » because a taller neighbour stretches its row: the check measures the text's own lines, not the cell's box.
