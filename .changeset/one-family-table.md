---
"@krizaka/org": minor
---

One family table (krizaka-internal#3913): `family` lists every member once (id, name, kind, group, status, hosts, bird, mark, words) and `products`, `sites`, the family groups and `brands` are computed from it. `org.json` gains `members` (the public rows). Kridoc is a product everywhere (`brandOf("kridoc").kind` is `product`), Krizaka Rust joins the open-source group (no site yet: its repository is the link), and Krizaka Agents is in the table as private, in no public view. Additive: schema 2.
