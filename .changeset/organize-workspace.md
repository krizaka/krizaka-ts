---
"@krizaka/organize": minor
---

The workspace, organised (ADR-003, #89): tags with colour markers scoped to a workspace (a shop, an account), status sets as data (ordered states, transitions with roles, final, confirm, reasons as a list, derived sets never moved), saved views with the URL as the state, bulk tag/untag/move with one audit line per entity, an event per status move and the product's consequence in the same transaction. The admin's configuration per kind lives in the database. `createWorkspace`, `dbWorkspaceStore`, `memoryWorkspaceStore`, `workspaceMigration`, `filterSql`; a browser-safe `@krizaka/organize/contract` for web, React Native and desktop; `@krizaka/organize/testkit` (`workspaceStoreContract`). Nothing of 0.3.0 changes.
