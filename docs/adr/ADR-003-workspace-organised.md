# ADR-003: The workspace, organised: tags with colour markers, status sets as data, saved views, bulk actions, one API for web, mobile and macOS

- **Status:** accepted (2026-10-25). Oussama delegated the design decision to the CTO, and the CTO validated this ADR (« validé »).
- **Issue:** krizaka/krizaka-ts#89. It unblocks krizaka/yomizaka#324 (P7, the pilot) and krizaka/akinaza#337 (D10), and comes before krizaka/krizaka-ts#90 (`@krizaka/intake` files what it takes in with these tags and statuses).
- **Builds on:** krizaka/.github ADR-006 (`@krizaka/organize`: tags, collections, the default collection), [ADR-001](ADR-001-modular-architecture.md) (the module shape, one Postgres schema per module, `tx` first, the outbox), `@krizaka/audit`, `@krizaka/webhooks`.
- **UI side:** krizaka/krizaka-ui#627 (marker palette, TagChip, StatusChip, saved views in FilterBar, the DataTable selection bar), krizaka-ui ADR-006 « Krizaka UI 2027 » (no new component without a first user, built on `chip`, `badge`, `filter-bar`, `data-table`), krizaka/krizaka-ui#648 (binder tabs, shipped).

## Context

Oussama (2026-10-24) wants the user to **shape their workspace**: tags with a small colour marker, statuses (« en attente, approuvé, rejeté »), so they can group, find and triage their work. The admin tunes the vocabulary per product, and it looks the same on the web, the phone and macOS.

What exists:
- **`@krizaka/organize` 0.3.0** gives tags per *owner* (an account), collections with an undeletable default one, and the `?tags=` URL rules (`parseTagsParam`, `tagsHref`). A tag colour is a **name** (`blue · green · amber · red · violet · gray`), never a hex (`packages/organize/src/rules.ts`).
- **Yomizaka** filters a collection's files on ALL the selected tags with its own SQL fragment (`apps/web/lib/organisation/store.ts:229`, `allTagsClause`).
- **Akinaza** uses the package for its shops, with the account as the owner (`packages/db/src/organize.ts`). Its tags on clients and invoices must belong to the **shop**: owner and manager write them, staff read them, a client never sees them (`packages/db/src/roles.ts`).
- Nothing has colours on a status, a status set, saved views or bulk actions.

What the two adopters asked on #89 (comments of 2026-10-24) shapes the decision:
- **Yomizaka:** two axes on an applicant file, never one chip: the link's state is a system fact (`linkState`), the decision is the user's set (à décider → retenu | non retenu). A decision can be **final and destructive** (it closes the file and purges its documents, Loi 25 minimisation): `final` and a `confirm` hint, undo only for non-final moves. **No score, no suggestion**: a status column is ordered by the set's order. **No free-text reason** about a person: if reasons exist they are a list, off by default. Documents get tags, not a status, in v1. System views and the user's; the address holds the state; on a phone the views are a menu. The tag palette is distinct from the status tones and from every product accent.
- **Akinaza:** some sets are **derived** (an invoice's due · partial · overdue · paid from the ledger, `invoiceState`; a booking from check-in): the same descriptor, chip and filter, but no move, no bulk move and no audit line of their own. Tags belong to the shop. Bulk actions are tag, untag and export; nothing touches the ledger. Another shop's tag or view id answers 404.

## Decision

### 1. One layer of `@krizaka/organize`, scoped to a workspace

The capability is a new layer of `@krizaka/organize` (minor **0.4.0**, additive: nothing of 0.3.0 changes). It is not a new package: it extends the « organize » block that already owns tags, and ADR-006's tags stay where they are for the products that use them.

- **The workspace is the scope**, declared by the product, like ADR-001's `scope` role: Yomizaka's account (later its organisation), Akinaza's shop. Every row of the layer carries its `scope_id` with a real foreign key, and every function takes the scope first. An id of another scope is **`NOT_FOUND` (404)**, never 403, so nothing leaks that it exists.
- **A kind** is a product entity table the layer organises (`applicant_file`, `client`, `invoice`), declared with the column (or condition) that puts an entity in a scope, and optionally its date column and its text columns for the filters.
- **Its tables live in their own Postgres schema** (`organize` by default, ADR-001 §3), generated per kind like ADR-006's join tables (real foreign keys, no `(kind, id)` pair the database cannot check):

  | Table | What it holds |
  |---|---|
  | `organize.kind_config` | the admin's configuration of one kind (§2), versioned |
  | `organize.tag` | a scope's tags of one kind: name, marker, origin (`preset` or `user`) |
  | `organize.<kind>_tag` | which entity wears which tag; `(tag_id, kind)` references the tag, so a tag of another kind cannot be worn |
  | `organize.<kind>_status` | the state of an entity in its kind's editable set, when, by whom |
  | `organize.view` | saved views: scope, kind, author, name, filters, shared |

### 2. The admin configures everything: one configuration per kind, in the database

The « admin configures everything » rule: the vocabulary is **data in the product's database**, which is the source of truth. The product's code only **seeds** it the first time (`config.seed`, never overwriting); afterwards only the admin's editor changes it (`config.put`), audited, with a version (a stale editor gets `CONFLICT`, 409).

```ts
interface KindConfig {
  kind: string;
  tags: {
    writers: string[];          // the roles that create, rename, remove and assign tags (Akinaza: owner, manager)
    userTags: boolean;          // false: only the admin's presets exist
    max: number;                // tags per scope and kind (1 to 200)
    presets: Record<string, { name: string; marker: Marker }[]>;  // by variant (a trade, or "default")
  };
  status: StatusSet | null;     // at most one set per kind in v1
  views: { key: string; label: Label; filters: ViewFilters }[];   // the product's system views
}
```

**Tags with a colour marker.**
- A marker is a **name from a closed palette**, the existing six (`blue · green · amber · red · violet · gray`, `TAG_COLORS`, exported as `MARKERS`). The store keeps the name; `@krizaka/tokens` maps it to `--kz-tag-<name>` and `--kz-tag-<name>-text` (krizaka/krizaka-ui#627), chosen to read on both themes (≥ 3:1 for the marker, ≥ 4.5:1 for its text) and **distinct from the status tones and from every product accent** (a tokens test). A marker is a mark beside the name (a dot, Yomizaka's bookmark ribbon), never the fill of a status. A new name is a later minor, with a migration that widens the check.
- The presets are the admin's default tag set; `tags.seed(scope, kind, variant)` copies them into a new scope once (Akinaza's default set per trade). The user adds their own only when `userTags` is on, up to `max`.

**Status sets as data.**

```ts
interface StatusSet {
  key: string;  label: Label;  mode: "editable" | "derived";
  states: { key: string; label: Label; tone: "neutral" | "accent" | "success" | "warning" | "danger"; final?: boolean }[];  // the order is the set's
  initial?: string;             // editable: the state of an entity nobody moved yet (not final)
  transitions: { from: string; to: string; roles: string[]; confirm?: boolean; reasons?: { key: string; label: Label }[] }[];
}
```

- **Ordered states**, each with a tone (the badge tones of Krizaka UI, not markers) and FR/EN labels (`Label = { fr, en }`, 1 to 40 characters).
- **Allowed transitions**, each with **the roles allowed to make it**. A final state has no way out: it is the one rule that makes « final » mean something.
- `confirm` asks the UI for a second press (Yomizaka's « refuser »). **Undo** is the reverse transition, offered only when the move did not reach a final state and the actor may make it back (`undoOf`).
- `reasons` is a list kept as data, **off by default** (no `reasons`, none accepted). There is **no free-text reason**, ever: a note about a person is personal information and invites discriminatory notes.
- **Derived sets** (`mode: "derived"`) have no `initial` and no transitions. The product computes the state (Akinaza's `invoiceState`); the layer gives the same descriptor, chip, order and filter. `status.move` refuses them (`STATUS_DERIVED`, 409), so no bulk move and no audit line exist for them: the ledger's entries are their audit.
- **The order of a status column is the set's order** (`statusOrder`). The layer never sorts, pre-fills or suggests a state from a computed value (a score, a check result).
- A **system state is not a status set.** Yomizaka's `linkState` stays the product's fact on its own chip.
- Editing the set refuses to remove a state that entities still hold (`STATE_IN_USE`, 409): the admin moves them first.

### 3. Saved views: the URL holds the state, the database keeps the name

- **Filters**: `tags` (ALL of them, as Yomizaka's `allTagsClause`), `status` (any of the states), `collection`, `from`/`to` (calendar days on the kind's date column) and `q` (text on the kind's text columns, at most 100 characters).
- **The URL is the state.** `parseView(searchParams)` reads `?view=&tags=&status=&collection=&from=&to=&q=` (anything else, or anything malformed, is dropped, never an error); `viewSearch(filters)` writes them back in one canonical order; `viewHref(path, filters, view?)` builds the link. A shared link opens the same list on another device.
- **Three kinds of view**, listed in this order: the **system views** of the configuration (the admin's), the **workspace's** views (`shared: true`, seen by every member of the scope), and **mine**. Only the author renames, changes, shares or deletes a view. Saving keeps the filters checked by the same rules as the URL, so a view and an address are the same thing.
- On a phone the views are a menu, on a wide screen a bar (krizaka/krizaka-ui#627); the API is the same.
- **One filter for every list.** `filterSql(decl, kind, filters, { scope, entity, from })` is the WHERE fragment a product adds to its own list query (it replaces Yomizaka's `allTagsClause`). Status filtering on a derived set uses the kind's `stateSql`, when the product declares it.

### 4. Bulk actions: one transaction, one audit line per entity

- **Tag, untag, move status**, and the product's own (move collection is ADR-006's `setCollection`, export is the product's CSV over the same `filterSql`). At most **200 entities** a call (`BULK_MAX`).
- **One transaction.** Every id must be in the scope, or the whole call answers `NOT_FOUND` before anything changes. A status move skips the entities that cannot make the move (already there, already final, not allowed) and **names them in `skipped`** with their code; the others move.
- **One audit line per entity** that changed (`organize.tags_changed`, `organize.status_changed`), never one line for the batch: the trail of a file tells its whole story.
- Nothing in the layer touches a product's ledger. Akinaza's « no bulk paid » holds by construction: a derived set cannot be moved.

### 5. Every transition audited, and an event through the outbox

- `status.move` runs in the product's transaction (`deps.transaction`). It reads each entity's state **with a row lock** (`FOR UPDATE`), so two people deciding the same file at once give one decision and one `STALE` (409) or `skipped`, never two. A single move may pass the state the user saw (`expect`) and gets `STALE` when it changed.
- In the same transaction, for every entity moved: the audit line (`deps.audit`, the `record(tx, entry)` of `@krizaka/audit`), the event (`deps.events.append(tx, event)`) and the product's own consequence (`deps.onMoved(tx, moves)`, where Yomizaka closes the file and purges its documents). Everything commits together or not at all.
- The event is `evt.organize.status.changed.v1` (ADR-001's form) with `{ scope, kind, entityId, from, to, final, reason, at }`. The product passes its outbox, or a wrapper over `@krizaka/webhooks`' `emit` until the outbox module exists. Tag changes are audited and emit no event in v1 (nothing consumes one yet; adding it is additive).
- Configuration changes are audited too (`organize.config_changed`, with the version), and so are tag creation and removal.

### 6. One API for the web, React Native and macOS

- **`@krizaka/organize/contract`** is browser-safe (no Node import, no SQL): the types (`KindConfig`, `StatusSet`, `ViewFilters`, `Tag`, the refusal codes), the palette, the status rules (`checkStatusSet`, `movesFrom`, `undoOf`, `statusOrder`) and the URL rules (`parseView`, `viewSearch`, `viewHref`). The web (Next.js), the phone (Expo) and macOS (Tauri) import the same file, so a rule cannot drift between them, and mobile and macOS get a change by upgrading.
- **`@krizaka/organize`** (server) adds `createWorkspace(deps)`, the store port with its PostgreSQL and in-memory adapters, `workspaceMigration(decl)` and `filterSql`. **`@krizaka/organize/testkit`** is the contract every store adapter runs.
- **HTTP**: the product mounts routes under its own authorisation (it knows the actor and the role); the shapes are the contract's types. The resources are `GET|PUT /organize/<kind>/config`, `GET|POST /organize/<kind>/tags`, `PATCH|DELETE /organize/<kind>/tags/:id`, `POST /organize/<kind>/tags/apply` (`{ ids, add, remove }`), `POST /organize/<kind>/status` (`{ ids, to, expect?, reason? }` → `{ moved, skipped }`), `GET|POST /organize/<kind>/views`, `PATCH|DELETE /organize/<kind>/views/:id`. Route factories (ADR-001 §5) come with the first product that mounts them twice; until then each product writes one thin route file over the service.
- **Screens** are Krizaka UI's (krizaka/krizaka-ui#627 for the chips, the views bar and the selection bar; the admin editors for tag sets and status sets are their own issue), on web and native.

### 7. Migrations and adoption

- `workspaceMigration(decl)` generates the SQL from the product's declaration. The product commits it in its own sequence with a drift test (Akinaza's `gen-*-migration.ts` practice, ADR-001 §3); later versions only add.
- **Yomizaka pilots** (krizaka/yomizaka#324, P7) on the applicant files: the editable set « à décider → retenu | non retenu » (both final, « non retenu » with `confirm`), tags with markers on files and documents (no status on documents), the system views (« À décider », « Décidés ») and the user's, bulk tag and decide. Its `allTagsClause` gives way to `filterSql`. Done when its tests prove: two presses to refuse, one audit line per file, the address holds the view, no sort by check result.
- **Akinaza follows** (krizaka/akinaza#337, D10): kinds `client` and `invoice` scoped to the shop (`scopeColumn: "shop_id"`), presets per trade, writers `owner` and `manager`, the invoice's derived set with its `stateSql`, saved views on clients, invoices and the agenda, bulk tag, untag and export, the binder dividers per tag (`Tabs variant="binder"`, krizaka/krizaka-ui#648). An editable set on client requests waits for the product decision that owners review them.
- Then the other products, one PR each, filed by the CTO.

## Rejected options

| Option | Why not |
|---|---|
| A new package (`@krizaka/workspace`) beside `organize` | Two packages would own « tags ». The layer extends the block that already has them and their URL rules, and a product imports one thing. |
| Widen 0.3.0's `tags` table (an owner column for the shop) | It changes a table three products already have, and an account-owned tag and a shop-owned tag are different things (who writes, who reads). The new layer adds tables and leaves 0.3.0 alone, as ADR-001's « minor only adds » requires. |
| One polymorphic `entity_tag (kind, entity_id)` table | ADR-006 refused it: the database cannot check the reference, and a deleted entity leaves orphans. Per-kind tables keep real foreign keys and `ON DELETE CASCADE`. |
| Status as a column on the product's table | Every product would write its own transitions, roles and audit. The set, its rules and its trail are the shared part. |
| The configuration in code (a constant per product) | The admin could not tune the vocabulary without a release. Code seeds it once; the database is the source of truth. |
| Several status sets per kind in v1 | No adopter needs two. One set keeps the URL (`status=`) and the screens simple; a second set is an additive minor when a product asks. |
| Free-text reasons on a decision | Personal information about a person, and an invitation to discriminatory notes (Yomizaka's applicants). A list of reasons as data is the most the layer accepts. |
| Sorting or pre-filling a status from a score | A decision about a person is the user's. The layer orders by the set, never by a computed value. |
| Hex colours, or a palette per product | A hex cannot follow the theme, and a palette per product is the drift the tokens prevent. Names in the store, hues in `@krizaka/tokens`. |
| Partial success that ignores ids of another scope | It would say which ids exist elsewhere by what it skips. Any foreign id fails the whole call with 404. |

## Consequences

- One place for the vocabulary, its rules and its trail; every product gets it by declaring its kinds and mounting the routes.
- The layer depends on nothing new: `@krizaka/audit` and the outbox (or `@krizaka/webhooks`) are passed in by shape, so a product that has neither still works.
- Yomizaka's and Akinaza's slices can start on 0.4.0. Their screens wait for krizaka/krizaka-ui#627; until it ships, a product composes `Chip`, `Badge`, `FilterBar` and `DataTable` behind one thin local wrapper, deleted the day the pieces land (ADR-006 §6).
- The cut: (1) this ADR; (2) the layer in `@krizaka/organize` 0.4.0 (rules, service, both stores, the contract kit, the migration, `filterSql`); (3) krizaka-ui#627 and the editors' issue; (4) Yomizaka P7; (5) Akinaza D10.
