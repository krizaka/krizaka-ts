---
"@krizaka/org": major
"@krizaka/sovkora-client": major
"@krizaka/settings": minor
"@krizaka/config": minor
"@krizaka/page-audit": patch
---

No retired code name anywhere (founder, 2026-11-06, krizaka-internal#2659).

- `@krizaka/org` 1.0.0: brand ids are the commercial names (`verikora`, `folioviv`, `sovkora`, `kridoc`); `OrgBrand.codeName` becomes `id`, `formerly` is gone; `CODE_NAMES` is the historic table (retired → id) and `brandOf(<retired>)` throws; `findCodeNames` and the `krizaka-code-names` bin refuse the retired names everywhere, in any case, with no allowed span (history: `CHANGELOG.md` is skipped); `org.products`, `org.family`, `apps/<id>.json` and `CastProduct` use the new ids; every product's runtime config points at `https://dev.<product>.com`.
- `@krizaka/sovkora-client` replaces `@krizaka/orazaka-client` (deprecated): `createSovkoraClient`, `SovkoraClient`, `SovkoraError`, `SOVKORA_CODE` with `SOVKORA_*` codes.
- `@krizaka/settings`: `displayNameSetting(id)` and the brand checks take the new ids. `@krizaka/config`: `no-hand-typed-family-name` names the products by their commercial names.
