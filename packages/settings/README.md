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
