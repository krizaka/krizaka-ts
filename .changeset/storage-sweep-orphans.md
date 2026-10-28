---
"@krizaka/storage": minor
---

`sweepOrphans(store, prefix, isReferenced, { dryRun, limit })`: deletes the files under a prefix that nothing references (leftovers of a rolled-back upload or an interrupted purge), reports scanned / orphans / deleted / failed, never stops on one failing delete.
