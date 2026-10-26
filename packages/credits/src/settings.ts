import { choice, integer, type Registry } from "@krizaka/settings";

import type { CreditsSettings } from "./port";
import { CREDITS_DEFAULTS, HOLD_TTL_BOUNDS } from "./rules";

/** Every IANA zone the runtime knows (the admin picks one; days and months are counted in it). */
const ZONES = Intl.supportedValuesOf("timeZone") as unknown as readonly [string, ...string[]];

/**
 * The settings of « credits », a fragment the product adds to its registry (`@krizaka/credits/settings`): the admin changes the zone
 * the caps are counted in and how long a hold keeps credits back, without a redeploy. Global scope only.
 */
export const creditsSettings = {
  "credits.timeZone": choice("credits", ZONES, CREDITS_DEFAULTS.timeZone),
  "credits.holdTtlSeconds": integer("credits", CREDITS_DEFAULTS.holdTtlSeconds, { min: HOLD_TTL_BOUNDS[0], max: HOLD_TTL_BOUNDS[1], unit: "seconds" }),
} as const satisfies Registry;

/**
 * The ledger's settings as `createCredits` takes them, from the product's accessor (`(key) => service.get(key, ctx)`).
 * A key the accessor does not know falls back to the default.
 */
export async function readCreditsSettings(read: (key: keyof typeof creditsSettings) => string | number | undefined | Promise<string | number | undefined>): Promise<CreditsSettings> {
  const zone = await read("credits.timeZone");
  const ttl = await read("credits.holdTtlSeconds");
  return { timeZone: typeof zone === "string" ? zone : CREDITS_DEFAULTS.timeZone, holdTtlSeconds: typeof ttl === "number" ? ttl : CREDITS_DEFAULTS.holdTtlSeconds };
}
