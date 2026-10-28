---
"@krizaka/auth": minor
---

Loading `@krizaka/auth` no longer calls `crypto.scrypt` (a top-level `promisify`): a client component that imports the role model or `can` from the barrel would throw at load in the browser bundle (akinaza#515). The call now happens when a password is hashed or checked.

New entry `@krizaka/auth/client`: `can`, `defineRoles`, `RoleModel`, `ROLES_CODE`, `RolesError` and the `/api/me` contract, with no `node:*` import — the import for client code. The repository now bundles every entry a package declares `krizaka.browserSafe` for the browser and fails on a node built-in (`scripts/browser-safe.test.mjs`).
