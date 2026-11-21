# @krizaka/org

## 1.14.1

### Patch Changes

- 8b709a7: A test now refuses any site description that names Maven Central or crates.io, where nothing of ours is published (krizaka-internal#4606).

## 1.14.0

### Minor Changes

- b05d49b: A family member may carry a `home` (krizaka-internal#4214): `audience` (`{fr, en}`, each at most `AUDIENCE_MAX` = 120 characters), `steps` (at most 3, each `{text: {fr, en}, state: "built" | "building" | "planned"}`, required for a product and the agents), `proofs` (`{kind, ref}`) and `action` (`{kind, href?, install?}`, `install` required when the kind is `install`). Typed (`MemberHome`, `HomeStep`, `HomeProof`, `HomeAction`), in the JSON Schema and checked by it. The field stays optional: no member carries words yet.

## 1.13.0

### Minor Changes

- 5abe44d: Every one of the 12 sites resolves its footer from the org JSON: `footer.sites` gains `rust` (developer footer) and `agents` (company footer), and `footerFor` lists only members that are public and live, so a member that is not live never appears in a family column.

## 1.12.0

### Minor Changes

- ee91000: The Krizaka Facebook Page is one of the organisation's social accounts (`links.social`), so every family footer draws it.
- ee91000: Krizaka Rust links to its site, `https://rust.krizaka.com` (it answers now); its repository stays the source link (krizaka-internal#4114, #3025).

## 1.11.0

### Minor Changes

- d2bf825: `footer.sites` now covers every site of the org: `blog`, `sovkora`, `verikora`, `folioviv` and `kridoc` join `krizaka`, `ui`, `lab`, `java` and `ts`, so `footerFor(id)` answers for the coming-soon pages and Kridoc with the same family columns, legal line and socials (krizaka-internal#4008).

## 1.10.0

### Minor Changes

- 83dc87c: `krizaka-family render <surface>` and `krizaka-family check <surface> <file>`: one renderer per surface kind (org profile, member README, repo README, founder profile, founder bio, social bios) written from the `family` table, with the block between the `krizaka:family` markers; `check` prints the diff with the expected view and exits 1 on a drift. Also exported as `renderSurface`, `checkSurface` and `SURFACES` (krizaka-internal#3914).

## 1.9.0

### Minor Changes

- 64d7b6d: One family table (krizaka-internal#3913): `family` lists every member once (id, name, kind, group, status, hosts, bird, mark, words) and `products`, `sites`, the family groups and `brands` are computed from it. `org.json` gains `members` (the public rows). Kridoc is a product everywhere (`brandOf("kridoc").kind` is `product`), Krizaka Rust joins the open-source group (no site yet: its repository is the link), and Krizaka Agents is in the table as private, in no public view. Additive: schema 2.

## 1.8.0

### Minor Changes

- bd4311b: Every site carries its bird, tone and description in the org JSON (krizaka-internal#3785). `OrgSite` gains `kind`, `mascot { bird, tone }`, `description` (FR/EN) and `aliases`; `sites` now lists the four products' sites too. One id per site across `sites`, `family` and `footer.sites` (`krizaka`, `lab`); the old ids `www` and `motion` stay as `aliases`, deprecated until 1.9.0. `footer.sites.rust` is removed: no such site exists. The Java description no longer names Maven Central.

## 1.7.1

### Patch Changes

- 79a6d53: SonarCloud smells cleared (second batch), behaviour unchanged: readonly sets, linear regular expressions, `replaceAll`, optional chains. The coverage reports now include the package's own `.js` / `.mjs` sources, and `@krizaka/org` keeps its default pictures and demo cast as JSON files. A contact e-mail address with an empty domain label (`a@b..c`) is no longer accepted by `@krizaka/coupons` and `@krizaka/mail`.

## 1.7.0

### Minor Changes

- dfb7ae5: Each product's bird lives in the org JSON: `org.mascot` (falcon, Krizaka's) and `org.products[*].mascot` (duck = Sovkora, owl = Verikora, beaver = Folioviv, crane = Kridoc), from the closed set `MASCOT_BIRDS` (the same ids as `MascotBird` in @krizaka/ui). The JSON schema requires them. Refs krizaka-internal#3642.

## 1.6.1

### Patch Changes

- 50bf475: Folioviv's cast: Myriam Dubé is an owner (she owns the Encre Vive Studio shop on dev; her account role is USER, not administrator), in the `ines-encrevive` workspace (krizaka-internal#2716).

## 1.6.0

### Minor Changes

- b7f7c28: Folioviv's persona cast names every dev account (krizaka-internal#2716): thirteen new personas with their full name and role, a new `staff` role.

## 1.5.0

### Minor Changes

- dd9728a: `org.products` and `org.family` list Kridoc (status `development`, `https://www.kridoc.com`, repository `krizaka/kridoc`). krizaka.com can read Kridoc's status from the org JSON, and `kridoc` is a system of the family that an architecture model can extend (krizaka-internal#3561). `apps` still holds the products that have an app: Kridoc has none.

## 1.4.0

### Minor Changes

- a4f475c: The org JSON tells each site what its footer shows: `footer.sites` (ui, lab, java, ts, rust, krizaka) selects the family groups, the social ids, the source link, the licence, the legal links and the version line, in the type and the published schema; `footerFor(siteId)` returns it resolved. Java has no Maven Central link.

## 1.3.0

### Minor Changes

- 6294faf: One closed set for a product's status, `PRODUCT_STATUS` (`design`, `upcoming`, `construction`, `development`, `paused`, `devPreview`), in the type, the JSON Schema and the exports, so a site reads it from `org.json` instead of typing its own (krizaka-internal#3425). Schema stays at 2 (a wider enum; the data still uses `development` for Sovkora, Verikora and Folioviv, whose pause is lifted).

## 1.2.0

### Minor Changes

- 274fc8c: Add LinkedIn to `org.links.social` (krizaka-internal#3141).

## 1.1.1

### Patch Changes

- 1eb999c: Add YouTube (`https://www.youtube.com/@krizakahq`) to `org.links.social` (krizaka-internal#365).

## 1.1.0

### Minor Changes

- 57a7bc7: Add `org.links.social`, Krizaka's own social accounts (Instagram, `https://www.instagram.com/krizakahq/`), with its JSON Schema and a type `OrgSocialLink`, so footers and structured data read the address from the org (krizaka-internal#365).

## 1.0.0

### Major Changes

- a8e1138: No retired code name anywhere (founder, 2026-11-06, krizaka-internal#2659).
  
  - `@krizaka/org` 1.0.0: brand ids are the commercial names (`verikora`, `folioviv`, `sovkora`, `kridoc`); `OrgBrand.codeName` becomes `id`, `formerly` is gone; `CODE_NAMES` is the historic table (retired → id) and `brandOf(<retired>)` throws; `findCodeNames` and the `krizaka-code-names` bin refuse the retired names everywhere, in any case, with no allowed span (history: `CHANGELOG.md` is skipped); `org.products`, `org.family`, `apps/<id>.json` and `CastProduct` use the new ids; every product's runtime config points at `https://dev.<product>.com`.
  - `@krizaka/sovkora-client` replaces the engine client published under its former code name (deprecated): `createSovkoraClient`, `SovkoraClient`, `SovkoraError`, `SOVKORA_CODE` with `SOVKORA_*` codes.
  - `@krizaka/settings`: `displayNameSetting(id)` and the brand checks take the new ids. `@krizaka/config`: `no-hand-typed-family-name` names the products by their commercial names.

## 0.7.2

### Patch Changes

- 1f380e9: krizaka-code-names: an element marked `data-code-name` (the development line « code name: yomizaka » that a dev deployment shows under the commercial name) is not read as a code name in a built page; the code name anywhere else still fails.

## 0.7.1

### Patch Changes

- 98ac3ca: krizaka-code-names: the target of a markdown link `[label](url)` and an autolink `<url>` is a URL, allowed; the label stays checked.

## 0.7.0

### Minor Changes

- bc85231: The commercial names (krizaka-internal#2035, #2036) as a seed, not as published data: `brands` / `brandOf` — Verikora (yomizaka), Folioviv (akinaza), Sovkora (orazaka), Kridoc (kachizaka, the managed storage) with their endorsement, domains and the one « formerly » line; `displayName`, `lockup`; the code-name guard `findCodeNames` / `visibleText` / `catalogueValues` and its CLI `krizaka-code-names`. `org.json` is unchanged (service discovery only). `@krizaka/settings`: `displayNameSetting` — the name an app shows is a setting its administrator changes, defaulting to the commercial name, never a code name.
- e602268: Every product and open-source entry of the family is `development` (nothing is released yet), and a `released` entry now needs a `releasedAt` date in data; a test refuses a mixed column or a release without its date.
- 9de9373: The family no longer lists Krizaka Skills (its content moved to a private repository).

## 0.6.0

### Minor Changes

- 7e0107b: `org.family`: every name of the family, written once — id, display name, short name, group, status, URL, repository — with `familyEntry(id)` and `familyName(id)`. The naming rule is tested: the company is « Krizaka », products go by their own name (Orazaka, Yomizaka, Akinaza), libraries and tools are « Krizaka <X> » (UI, Java, TypeScript, Lab, Skills). Fixes « Krizaka TS » → « Krizaka TypeScript »; product URLs are their canonical `www.<product>.com`.

## 0.5.0

### Minor Changes

- 32c80b5: Orazaka is "development" like every product of the family (krizaka-com#468): no product wears "devPreview" any more.

### Patch Changes

- d9f91aa: The family's open-source list names the lab Krizaka Lab, at lab.krizaka.com.

## 0.4.0

### Minor Changes

- bdd0ec1: The cast has Orazaka: Éric (user), Mira (administrator) and Krizaka (the company as a customer), the accounts already deployed on dev, so the greeting never reads « qa_user » (krizaka/.github#356, krizaka/orazaka#473).

## 0.3.1

### Patch Changes

- 8afbe46: The demo cast is Éric, Mira and Camille in each product, as the deployed QA accounts (Akinaza also Léa and her clients). Lost from 0.3.0: that last commit was pushed after the merge queue took the pull request.

## 0.3.0

### Minor Changes

- 992862a: `cast`: the demo cast of the family (one fictitious person per role and product, with avatar and banner from the org defaults), `castOf`, `persona`, `personaByRole`, `castMedia` and `seedFingerprint`. Apps seed and record from it; no e-mail or password lives here.

## 0.2.1

### Patch Changes

- b5b70d3: The neon flamingo banner (`banner/the-neon-flamingo`) is withdrawn from the defaults: it carries the wordmark of a paused product. It stays in the JSON with `disabled: true` and its files stay served (a versioned URL never changes), but `listDefaults` and `defaultFor` skip it, so a banner is picked among eleven. The schema accepts `disabled`; a test holds that no default names a paused product.

## 0.2.0

### Minor Changes

- 9cc4d12: The org JSON gains a `defaults` section (schemaVersion 2, compatible: everything of 1 is unchanged): the central sets of default pictures per kind (`person`, `folder`, `organisation`, `shop`, `banner`), each item with an id, an alt in English and French and its URLs per size on Bunny `defaults/v1/<kind>/`, plus the deterministic rule. New exports `listDefaults(kind)`, `defaultFor(kind, seed)`, `defaultUrl(item, size)`, `fetchDefaults(url)`, `seedHash`, `DEFAULT_KINDS`. Default media URLs come from here, never hard-coded in an app (krizaka-ts#134).

## 0.1.0

### Minor Changes

- 9ccfb32: First release: the public facts about Krizaka in one validated JSON (company, brand, default avatars, live products, sites, contact, footer line), its JSON Schema and types, the mobile apps' public runtime config, and the CDN publish of `org/v1/org.json`.
