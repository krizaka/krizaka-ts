---
"@krizaka/org": minor
---

`krizaka-family render <surface>` and `krizaka-family check <surface> <file>`: one renderer per surface kind (org profile, member README, repo README, founder profile, founder bio, social bios) written from the `family` table, with the block between the `krizaka:family` markers; `check` prints the diff with the expected view and exits 1 on a drift. Also exported as `renderSurface`, `checkSurface` and `SURFACES` (krizaka-internal#3914).
