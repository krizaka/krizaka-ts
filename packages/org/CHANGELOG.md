# @krizaka/org

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
