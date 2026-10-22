# @krizaka/organize

## 0.2.0

### Minor Changes

- 0aebad3: `storedAvatarKey` (where an uploaded avatar lives in the object store, so a product can sign a link to it) and `collectionTags` (the collections' tag join table, for a product that already has one under another name).

## 0.1.0

### Minor Changes

- 3ccd69b: First release: the pure rules of « organize » — names, descriptions, tag colours, ids and the `tags` URL parameter.
- 0d12d6d: A kind may say how an entity is its owner's (`owns`) when its table has no owner column, a collection takes a product's extra columns on creation, and tagging needs no name or avatar column.
- 1d6d9fc: The service: collections with an undeletable default one (invariants in the database), tags, and the name, description, avatar (a set or an uploaded image behind two ports) and collection of any declared kind; the migration generator; tests against PostgreSQL.
