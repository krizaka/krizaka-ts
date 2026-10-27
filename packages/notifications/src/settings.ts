import { flag, integer, type Registry } from "@krizaka/settings";

import { CHANNELS, type NotificationConfig } from "./port";
import { type Channel, NOTIFICATION_CODE, NotificationError } from "./port";
import { CATEGORY_NAME, NOTIFICATION_BOUNDS, NOTIFICATION_DEFAULTS } from "./rules";

/** What a product declares for a category; the admin tunes the values (except `locked`, which is code). */
export interface CategoryDeclaration {
  /** Cannot be switched off by the account or the admin (security, the account). Its channels are exactly `defaults`. */
  locked?: boolean;
  defaults: Record<Channel, boolean>;
  burst?: { max: number; windowSeconds: number };
}

export type Declared = Record<string, CategoryDeclaration>;

const burstOf = (d: CategoryDeclaration) => d.burst ?? { max: NOTIFICATION_DEFAULTS.burstMax, windowSeconds: NOTIFICATION_DEFAULTS.burstWindowSeconds };

/**
 * The settings of « notifications » for the categories a product declares, a fragment it adds to its registry
 * (`@krizaka/notifications/settings`): for each category the channels on by default (`notifications.<category>.<channel>`, not for a
 * locked category) and its burst cap (`notifications.<category>.burstMax`, `burstWindowSeconds`), plus `notifications.retentionDays`.
 * The admin changes them without a redeploy.
 * @throws NotificationError when a category name is not a camel-case word
 */
export function notificationSettings(declared: Declared): Registry {
  const registry: Registry = {
    "notifications.retentionDays": integer("notifications", NOTIFICATION_DEFAULTS.retentionDays, { min: NOTIFICATION_BOUNDS.retentionDays[0], max: NOTIFICATION_BOUNDS.retentionDays[1], unit: "days" }),
  };
  for (const [name, d] of Object.entries(declared)) {
    if (!CATEGORY_NAME.test(name)) throw new NotificationError(NOTIFICATION_CODE.badConfig, `category « ${name} » must be a camel-case word`);
    const group = `notifications.${name}`;
    if (!d.locked) for (const channel of CHANNELS) registry[`notifications.${name}.${channel}`] = flag(group, d.defaults[channel]);
    const burst = burstOf(d);
    registry[`notifications.${name}.burstMax`] = integer(group, burst.max, { min: NOTIFICATION_BOUNDS.burstMax[0], max: NOTIFICATION_BOUNDS.burstMax[1], unit: "notifications" });
    registry[`notifications.${name}.burstWindowSeconds`] = integer(group, burst.windowSeconds, { min: NOTIFICATION_BOUNDS.burstWindowSeconds[0], max: NOTIFICATION_BOUNDS.burstWindowSeconds[1], unit: "seconds" });
  }
  return registry;
}

type Reader = (key: string) => boolean | number | undefined | Promise<boolean | number | undefined>;

/**
 * The module's configuration as `createNotifications` takes it, from the product's accessor (`(key) => service.get(key, ctx)`).
 * A key the accessor does not know falls back to what the product declared.
 */
export async function readNotificationConfig(declared: Declared, read: Reader): Promise<NotificationConfig> {
  const number = async (key: string, fallback: number) => {
    const value = await read(key);
    return typeof value === "number" ? value : fallback;
  };
  const categories: NotificationConfig["categories"] = {};
  for (const [name, d] of Object.entries(declared)) {
    const defaults = { ...d.defaults };
    if (!d.locked) {
      for (const channel of CHANNELS) {
        const value = await read(`notifications.${name}.${channel}`);
        if (typeof value === "boolean") defaults[channel] = value;
      }
    }
    const burst = burstOf(d);
    categories[name] = { locked: d.locked ?? false, defaults, burstMax: await number(`notifications.${name}.burstMax`, burst.max), burstWindowSeconds: await number(`notifications.${name}.burstWindowSeconds`, burst.windowSeconds) };
  }
  return { categories, retentionDays: await number("notifications.retentionDays", NOTIFICATION_DEFAULTS.retentionDays) };
}
