# @krizaka/organize

A **name, an avatar, a description, tags, collections and an undeletable default collection** for any entity of a Krizaka product
(ADR-006). No ORM, no framework, no image library: you pass a `query` function and, for uploaded avatars, an `AvatarProcessor` and an `ObjectStore`.

```ts
import { emitMigration } from "@krizaka/db";
import { createOrganize, organizeSchema } from "@krizaka/organize";

const schema = { defaultName: { fr: "Mes boutiques", en: "My shops" }, kinds: { shop: { table: "shops" } } };
emitMigration(organizeSchema(schema), 1, { tables: {} }); // commit the SQL once, in your migrations
const organize = createOrganize({ query: (sql, params) => pool.query(sql, params).then((r) => r.rows), schema, images });

await organize.collections.create(owner, { name: "Quartier Est" });
await organize.profile("shop").rename(owner, shopId, "Salon Cèdre");
await organize.tags.assign(owner, "shop", shopId, [tagId]);
```

**Schema.** The tables are a `@krizaka/db` module (`organize`), version 1 byte-identical to the SQL this package shipped before, so a product that has them adopts with no DDL change: `adoptMigration(organizeSchema(schema), 1, context)` writes the marker only, `emitMigration(…)` writes the SQL for a database that lacks them. The old migration function stays, `@deprecated`, for one minor. The workspace layer is the module `organize_workspace` (`workspaceSchema(declaration)`), in its own Postgres schema.
- The invariants are the database's: one default collection per owner (exclusion constraint + deferred trigger), never deleted while its owner
  exists, created with the owner in its language, and every entity given no collection falls into it.
- Refusals are `OrganizeError` with a stable `code` and `status` (`DEFAULT_COLLECTION`, `NAME_TAKEN`, `AVATAR_NOT_ALLOWED`…): a product maps them to its own answers.
- Pure rules for the URL: `parseTagsParam`, `toggleTag`, `tagsHref`.

## The workspace, organised (ADR-003)

Tags with a colour marker, **status sets as data**, **saved views** and **bulk actions**, scoped to a **workspace** the product
declares (an account, a shop), configured by the admin in the database, audited. Decision: [ADR-003](../../docs/adr/ADR-003-workspace-organised.md).

```ts
import { createWorkspace, dbWorkspaceStore, filterSql, parseView, workspaceSchema, type WorkspaceDecl } from "@krizaka/organize";

const decl: WorkspaceDecl = { scope: "shops", users: "accounts", kinds: { client: { table: "clients", scopeColumn: "shop_id", textColumns: ["name"] } } };
emitMigration(workspaceSchema(decl), 1, { tables: {} }); // committed in your own sequence, with a drift test

const workspace = createWorkspace({
  transaction: (work) => db.transaction(work),          // every change runs in one
  storeFor: (tx) => dbWorkspaceStore(tx, decl),
  clock,
  audit,                                                // `createAudit(…)` of @krizaka/audit: one line per entity changed
  events: { append: (tx, event) => outbox.append(tx, event) }, // evt.organize.status.changed.v1
  onMoved: (tx, moves) => closeFiles(tx, moves),        // the product's consequence, in the same transaction
});

await workspace.config.seed(defaults);                  // once; the admin's editor changes it after (config.put, versioned)
await workspace.tags.apply(shopId, actor, "client", { ids, add: [tagId] });         // bulk: ≤ 200, any foreign id → 404
await workspace.status.move(shopId, actor, "file", { ids: [id], to: "retenu", expect: "a_decider" }); // { moved, skipped }
const where = filterSql(decl, "client", parseView(searchParams).filters, { from: 2, status: config.status });
```

- **Configuration per kind, in the database** (`KindConfig`): the roles that write tags, whether users add their own, the max,
  the presets by variant (a trade); the status set; the system views. `config.seed` writes the product's defaults once,
  `config.put` is the admin's change (`CONFLICT` when stale, `STATE_IN_USE` when it drops a state entities hold).
- **Markers** are names of a closed palette (`MARKERS`); `@krizaka/tokens` maps them to `--kz-tag-<name>`. Never a hex.
- **Status sets**: ordered states (tone, FR/EN labels, `final`), transitions with the roles that may make them, `confirm`,
  `reasons` as a list (never free text); `derived` sets are computed by the product and never moved (`STATUS_DERIVED`).
  `movesFrom`, `checkMove`, `undoOf` (never out of a final state), `statusOrder` (a column's order is the set's).
- **Saved views**: `parseView` / `viewSearch` / `viewHref` (the URL is the state), `checkViewFilters`; system · workspace · mine.
- **`@krizaka/organize/contract`** is browser-safe (web, Expo, Tauri): the types, the codes, the palette, the status and view rules.
- **`@krizaka/organize/testkit`**: `workspaceStoreContract`, run by the memory and PostgreSQL stores and by any other adapter.
