---
"@krizaka/config": patch
---

`not-to-dev-dep` no longer flags a package that is also a `peerDependency`: a library declares it for its consumer and keeps a devDependency to test with (krizaka-ts#57).
