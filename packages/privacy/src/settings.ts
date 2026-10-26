import { integer, type Registry } from "@krizaka/settings";

import { checkPurpose } from "./rules";

/** The settings key of a purpose's retention: `payment-history` → `privacy.retention.paymentHistoryDays` (a key holds letters and digits only). */
export const retentionKey = (purpose: string): string => `privacy.retention.${purpose.replace(/[-_]([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Days`;

/**
 * The registry fragment of the retention: `privacy.retention.<purpose>Days` for each purpose the product declares, an integer with the
 * product's default. Global scope. The admin sets how long what a purpose collected is kept; the product's job calls `purge`.
 * @param purposes the product's purposes (`screening`, `payment-history`), with their default retention in days
 * @throws PrivacyError for a purpose id that is not well formed, or two that give the same key
 */
export function privacySettings(purposes: Readonly<Record<string, { retentionDays: number }>>): Registry {
  const fragment: Registry = {};
  for (const [purpose, { retentionDays }] of Object.entries(purposes)) {
    checkPurpose(purpose);
    const key = retentionKey(purpose);
    if (key in fragment) throw new RangeError(`privacy purposes give the same settings key: ${key}`);
    // @fixed: a purpose is kept from a day to ten years; the default is the product's
    fragment[key] = integer("privacy", retentionDays, { min: 1, max: 3650, unit: "days" });
  }
  return fragment;
}

/** The retention of a purpose as `createPrivacy` takes it, from the product's accessor (`(key) => service.get(key, ctx)`). */
export function retentionFromSettings(read: (key: string) => number | undefined | Promise<number | undefined>): (purpose: string) => Promise<number | undefined> {
  return async (purpose) => read(retentionKey(purpose));
}
