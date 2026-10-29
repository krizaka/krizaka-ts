---
"@krizaka/storage": minor
---

`storageSettings` has `storage.userConnectors` (flag, **off by default**): the admin's policy on whether people may connect their own cloud (Dropbox, an S3 of their own). `userConnectorsAllowed(read)` reads it; anything but an explicit `true` is off.
