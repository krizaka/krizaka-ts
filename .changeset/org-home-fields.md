---
"@krizaka/org": minor
---

A family member may carry a `home` (krizaka-internal#4214): `audience` (`{fr, en}`, each at most `AUDIENCE_MAX` = 120 characters), `steps` (at most 3, each `{text: {fr, en}, state: "built" | "building" | "planned"}`, required for a product and the agents), `proofs` (`{kind, ref}`) and `action` (`{kind, href?, install?}`, `install` required when the kind is `install`). Typed (`MemberHome`, `HomeStep`, `HomeProof`, `HomeAction`), in the JSON Schema and checked by it. The field stays optional: no member carries words yet.
