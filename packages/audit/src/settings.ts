import { integer, type Registry } from "@krizaka/settings";

/**
 * The settings of « audit », a fragment the product adds to its registry: the admin sets how long the trail is kept, and
 * the product's job calls `purge` with it. Global scope only.
 */
export const auditSettings = {
  // @fixed: three years by default; the admin chooses between one month and ten years.
  "audit.retentionDays": integer("audit", 1095, { min: 30, max: 3650, unit: "days" }),
} as const satisfies Registry;
