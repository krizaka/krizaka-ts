# @krizaka/settings

A product's configuration as **data**: a typed registry of settings (flags, integers, choices, subsets, bilingual texts), resolved **user → workspace → global → default**, changed by an administrator without a redeploy, **every change leaving an audit line** (who, what, when, before, after). A JSON-safe description of the registry is what an admin screen draws from.

```ts
import { defineSettings, flag, integer, postgresSettings, settingsMigration, GLOBAL, WORKSPACE_SCOPES } from "@krizaka/settings";

const settings = defineSettings({ "features.apiKeys": flag("features", true, WORKSPACE_SCOPES), "limits.maxFileMb": integer("limits", 10, { min: 1, max: 10, unit: "MB" }) } as const);
await db.query(settingsMigration()); // once, in your migrations (idempotent)
const service = postgresSettings(settings, { query, workspaceOf, clock: () => performance.now() });
await service.get("features.apiKeys", { userId });            // typed: boolean
await service.set({ id: adminId, label: email }, GLOBAL, "features.apiKeys", false, now);
```

What stays in the product: its registry (the keys, groups, defaults), the checks it makes at its own boundary (« the server refuses what is off »), who may be an administrator, the HTTP routes. The clock is passed in; nothing here reads it.

## Prices — the catalogue (ADR-009)

A product's prices are data too: a typed **catalogue** of entries (`product.plan`, unit, amount in cents or « on quote », **CAD**,
**before taxes**, availability `public` · `internal` · `founder-limited` · `preparing`, named limits). The product's former pricing
module becomes the **seed**; its administrator changes an entry by **scheduling a version from a date** (now or later, never the
past), and every change writes an audit line in `settings_audit` (`price.<product>.<plan>`). A subscription records the version it
was sold at (`versionId`) and keeps it.

```ts
import { AVAILABILITY, definePrices, findTypedPrices, priceCatalogue, pricesMigration, priceStore, publicCatalogue, UNIT } from "@krizaka/settings";

const prices = definePrices([
  { product: "akinaza", plan: "starter", unit: UNIT.month, amountCents: 4500, availability: AVAILABILITY.founderLimited, limits: { founderCap: 20 } },
  { product: "akinaza", plan: "scale", unit: UNIT.month, amountCents: 9900, availability: AVAILABILITY.preparing },
]);
await db.query(pricesMigration()); // once, in your migrations (idempotent; includes the settings' tables)
const catalogue = priceCatalogue(prices, priceStore({ query }));
const shown = publicCatalogue(await catalogue.catalogue(now));   // a public page: never internal, « en préparation » without a figure
await catalogue.schedule({ id: adminId, label: email }, "akinaza.starter", { amountCents: 4900 }, effectiveFrom, now);
const sold = await catalogue.version(subscription.priceVersionId); // the price it was sold at, forever
expect(findTypedPrices(messages)).toEqual([]);                    // a product's test: no amount typed in a message
```

`describePrices(catalogue, now)` is the JSON-safe description an admin screen draws (with what is already scheduled);
`memoryPriceStore()` serves tests. The amount reaches the processor through `@krizaka/payments`, by the entry's key.
