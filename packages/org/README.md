# @krizaka/org

**The public facts about Krizaka, in one validated JSON.** The legal name, the NEQ, « Fait à Montréal » in French and English,
the brand marks, the default avatars, the live products (Orazaka, Yomizaka, Akinaza), the sites, the public contact, the footer
line and the legal links — read by every footer, site and app, so changing one takes one pull request here.

```ts
import { footerLine, org } from "@krizaka/org";

footerLine("fr"); // « Une entreprise de Technologies Krizaka · Fait à Montréal »
org.company.legalName; // « Technologies Krizaka Inc. »
```

Without a build step, read it from the CDN: [krizaka-assets.b-cdn.net/org/v1/org.json](https://krizaka-assets.b-cdn.net/org/v1/org.json) (an immutable copy sits beside it,
`org.<hash>.json`). Also exported: `@krizaka/org/org.json`, `@krizaka/org/org.schema.json` and `@krizaka/org/apps/<product>.json`.

- **Default media come from here.** The `defaults` section lists the central sets of default pictures — `person`, `folder`,
  `organisation`, `shop`, `banner` — with id, alt text in English and French and the URLs per size on Bunny
  (`defaults/v1/<kind>/<id>-<size>.<ext>`, written by krizaka-ui `tools/export-defaults.mjs`). An app never hard-codes or bundles one:
  `listDefaults(kind)` lists them, `defaultFor(kind, seed)` picks one deterministically (FNV-1a of the seed, modulo the list), `defaultUrl(item, size)` gives the URL,
  `fetchDefaults(ORG_URL)` reads the section from the published JSON. A folder is never given a person.
- **Public facts only.** Never an address, a phone number, figures, a secret, an IP address or an internal host: the test
  scans for them and the schema refuses any field it does not list.
- **Validated.** `orgSchema` (JSON Schema 2020-12) and the types `Org`, `AppConfig`…; a test validates the data and requests every
  URL in it.
- **Mobile runtime config.** `apps/<product>.json` holds what a client may know — the API base URL per environment, feature flags,
  the minimum app version — never a secret. An app reads it at start, with a copy built into the binary as fallback.
- **Published on each release** by the Release workflow (`pnpm run publish:cdn`), needing the organisation secrets
  `MEDIA_STORAGE_API_KEY` and `MEDIA_STORAGE_ZONE`; without them it warns and publishes nothing.

Apache-2.0 · [Krizaka TypeScript](https://github.com/krizaka/krizaka-ts)
