---
"@krizaka/auth": patch
---

Loading `@krizaka/auth` no longer calls `crypto.scrypt` (a top-level `promisify`): a client component that imports the role model or `can` from the barrel would throw at load in the browser bundle (akinaza#515). The call now happens when a password is hashed or checked.
