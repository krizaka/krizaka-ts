---
"@krizaka/storage": patch
---

The default entry is safe on Edge and in the browser: no `node:` import, nothing reads a file. It carries the types and the port, the region table, `describeStore`, `storageNotice`, the endpoint check, `sniffType`, the key rules and the in-memory store. The adapters that hash, sign, encrypt or touch the disk (`createStorage`, `bucketStore`, `remoteStore`, `folderStore`, `encryptedStore`, `hashedName`, `seal`/`open`) are in `@krizaka/storage/node`, and `.` still resolves to them under the `node` condition, so Node code keeps working unchanged. A test bundles the default entry for the browser and fails on any `node:` or `fs` import.
