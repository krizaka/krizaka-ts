# @krizaka/organize

A **name, an avatar, a description, tags, collections and an undeletable default collection** for any entity of a Krizaka product
(ADR-006). No ORM, no framework, no image library: you pass a `query` function and, for uploaded avatars, an `AvatarProcessor` and an `ObjectStore`.

```ts
import { createOrganize, organizeMigration } from "@krizaka/organize";

const schema = { defaultName: { fr: "Mes boutiques", en: "My shops" }, kinds: { shop: { table: "shops" } } };
await db.query(organizeMigration(schema)); // once, in your migrations
const organize = createOrganize({ query: (sql, params) => pool.query(sql, params).then((r) => r.rows), schema, images });

await organize.collections.create(owner, { name: "Quartier Est" });
await organize.profile("shop").rename(owner, shopId, "Salon Cèdre");
await organize.tags.assign(owner, "shop", shopId, [tagId]);
```

- The invariants are the database's: one default collection per owner (exclusion constraint + deferred trigger), never deleted while its owner
  exists, created with the owner in its language, and every entity given no collection falls into it.
- Refusals are `OrganizeError` with a stable `code` and `status` (`DEFAULT_COLLECTION`, `NAME_TAKEN`, `AVATAR_NOT_ALLOWED`…): a product maps them to its own answers.
- Pure rules for the URL: `parseTagsParam`, `toggleTag`, `tagsHref`.
