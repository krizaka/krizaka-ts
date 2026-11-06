# @krizaka/org

**The public facts about Krizaka, in one validated JSON.** The legal name, the NEQ, « Fait à Montréal » in French and English,
the brand marks, the default avatars, the live products (Sovkora, Verikora, Folioviv), the sites, the public contact, the footer
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
- **One name per entry of the family.** `org.family` (and `familyName(id)`) is the only place a name is written: the company
  is « Krizaka », a product goes by its own name (Sovkora, Verikora, Folioviv — never « Krizaka Verikora »), a library or a tool
  is « Krizaka <X> » (Krizaka UI, Krizaka Java, Krizaka TypeScript, Krizaka Lab; the short name only under a
  heading « Open source »). The bar, the switcher and every footer read it; a test holds the rule.
- **Public facts only.** Never an address, a phone number, figures, a secret, an IP address or an internal host: the test
  scans for them and the schema refuses any field it does not list.
- **Validated.** `orgSchema` (JSON Schema 2020-12) and the types `Org`, `AppConfig`…; a test validates the data and requests every
  URL in it.
- **Mobile runtime config.** `apps/<product>.json` holds what a client may know — the API base URL per environment, feature flags,
  the minimum app version — never a secret. An app reads it at start, with a copy built into the binary as fallback.
- **Published on each release** by the Release workflow (`pnpm run publish:cdn`), needing the organisation secrets
  `MEDIA_STORAGE_API_KEY` and `MEDIA_STORAGE_ZONE`; without them it warns and publishes nothing.

Apache-2.0 · [Krizaka TypeScript](https://github.com/krizaka/krizaka-ts)

## What `org.json` is, and what it is not

**Service discovery only** (founder, 2026-11-01): the addresses and versions clients resolve (API URLs, minimum and latest app
versions, the default media, the family's names and addresses). It is read at start by the apps and published at each release.
Names, status, store availability, social links and the footer contents are **not** in it: they are admin configuration of each
app in its database, through `@krizaka/settings` (audit trail), read at runtime and at build where needed (a save redeploys).
The shared validation (no code name as a display name, FR/EN labels, valid URLs) lives in the settings package.

A rename is therefore: the administrator edits the value in the app's settings, saves, and the build-time pages redeploy.
The seed below is only the default of that setting.

## Brands (`brands`, a seed)

Since 1.0.0 (founder, 2026-11-06, krizaka-internal#2659) a brand's id **is** its commercial name in lower case — `verikora`,
`folioviv`, `sovkora`, `kridoc` — in repositories, packages, hosts and code alike. A customer reads it endorsed by the company:
**« Verikora by Krizaka »** / **« Verikora par Krizaka »**.

```ts
import { brandOf, displayName, lockup } from "@krizaka/org";
brandOf("folioviv").domains.shop; // "https://folioviv.shop"
displayName("verikora", settingValue); // the admin's choice (`brand.displayName`), else « Verikora »
lockup("sovkora", "fr"); // « Sovkora par Krizaka »
```

**The historic table.** `CODE_NAMES` maps each retired code name to its brand id; it is the one place they are written. There
is no alias: `brandOf(<retired code name>)` throws and names the new id.

**The guard.** `npx krizaka-code-names [--report] [--allow <path-part>]... <file-or-dir>...` reads every text file under the
roots (code, configs, workflows, docs, messages, built HTML) and fails on a retired code name in any case, as a word or inside
one (environment variables, CSS classes, hosts, URLs, package coordinates, code spans): there is no allowed span. History is skipped
(`CHANGELOG.md` files); `--allow` skips the paths that hold a copy of the rename table. Kridoc's former wording is refused too.

### Upgrading from 0.x

- `OrgBrand.codeName` is now `OrgBrand.id`; `formerly` is gone. Call `brandOf`, `displayName` and `lockup` with the new ids.
- `CODE_NAMES` is a frozen `Record<retired, id>` (it was the list of ids); `codeNameMap()` maps retired → commercial name.
- `findCodeNames` allows nothing any more (URLs, hosts, `@krizaka/*`, `com.krizaka.*`, backticks were allowed before), and
  `visibleText` no longer drops a `data-code-name` line.
- `org.products` / `org.family` ids, `apps/<id>.json` and `CastProduct` use the new ids.
