---
"@krizaka/org": minor
---

The org JSON gains a `defaults` section (schemaVersion 2, compatible: everything of 1 is unchanged): the central sets of default pictures per kind (`person`, `folder`, `organisation`, `shop`, `banner`), each item with an id, an alt in English and French and its URLs per size on Bunny `defaults/v1/<kind>/`, plus the deterministic rule. New exports `listDefaults(kind)`, `defaultFor(kind, seed)`, `defaultUrl(item, size)`, `fetchDefaults(url)`, `seedHash`, `DEFAULT_KINDS`. Default media URLs come from here, never hard-coded in an app (krizaka-ts#134).
