---
"@krizaka/organize": minor
---

`organizeSchema(declaration)` and `workspaceSchema(declaration)`: collections and tags, and the workspace layer, as `@krizaka/db` modules, version 1 byte-identical to `organizeMigration` and `workspaceMigration` (a product adopts with no DDL change). `Query` and `Clock` are `@krizaka/db`'s, re-exported under the same names. The two migration functions are deprecated (#51).
