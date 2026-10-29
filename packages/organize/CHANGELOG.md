# @krizaka/organize

## 0.5.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0

## 0.5.0

### Minor Changes

- 273c554: `organizeSchema(declaration)` and `workspaceSchema(declaration)`: collections and tags, and the workspace layer, as `@krizaka/db` modules, version 1 byte-identical to `organizeMigration` and `workspaceMigration` (a product adopts with no DDL change). `Query` and `Clock` are `@krizaka/db`'s, re-exported under the same names. The two migration functions are deprecated (#51).

### Patch Changes

- Updated dependencies [273c554]
  - @krizaka/db@0.2.0

## 0.4.0

### Minor Changes

- 7f6bafd: The workspace, organised (ADR-003, #89): tags with colour markers scoped to a workspace (a shop, an account), status sets as data (ordered states, transitions with roles, final, confirm, reasons as a list, derived sets never moved), saved views with the URL as the state, bulk tag/untag/move with one audit line per entity, an event per status move and the product's consequence in the same transaction. The admin's configuration per kind lives in the database. `createWorkspace`, `dbWorkspaceStore`, `memoryWorkspaceStore`, `workspaceMigration`, `filterSql`; a browser-safe `@krizaka/organize/contract` for web, React Native and desktop; `@krizaka/organize/testkit` (`workspaceStoreContract`). Nothing of 0.3.0 changes.

## 0.3.0

### Minor Changes

- e82e92e: `legacyAvatarKey`: a product's older image keys are read and deleted as a fallback, never written.

## 0.2.0

### Minor Changes

- 0aebad3: `storedAvatarKey` (where an uploaded avatar lives in the object store, so a product can sign a link to it) and `collectionTags` (the collections' tag join table, for a product that already has one under another name).

## 0.1.0

### Minor Changes

- 3ccd69b: First release: the pure rules of « organize » — names, descriptions, tag colours, ids and the `tags` URL parameter.
- 0d12d6d: A kind may say how an entity is its owner's (`owns`) when its table has no owner column, a collection takes a product's extra columns on creation, and tagging needs no name or avatar column.
- 1d6d9fc: The service: collections with an undeletable default one (invariants in the database), tags, and the name, description, avatar (a set or an uploaded image behind two ports) and collection of any declared kind; the migration generator; tests against PostgreSQL.
