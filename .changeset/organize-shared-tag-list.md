---
"@krizaka/organize": minor
---

One tag list shared by several kinds: a kind may declare `tagList: "<other kind>"` (same names, markers and `lower(name)` uniqueness, a link table of its own), `workspace.tags.counts(scope)` gives the usage count of each tag per kind, and `filterSql(…, { inherit: true })` also matches the tags worn by an entity's container (`containerKind`). Additive: kinds without `tagList` behave as before.
