import { flag, integer, type Registry } from "@krizaka/settings";

import type { CouponSettings } from "./port";
import { COUPON_ATTEMPT_ACTION, COUPON_BOUNDS, COUPON_DEFAULTS } from "./rules";

const int = <K extends keyof typeof COUPON_BOUNDS>(key: K, unit: string) => integer("coupons", COUPON_DEFAULTS[key], { min: COUPON_BOUNDS[key][0], max: COUPON_BOUNDS[key][1], unit });

/**
 * The settings of « coupons », a fragment the product adds to its registry (`@krizaka/coupons/settings`): the admin changes them
 * without a redeploy, every change audited by the settings service. Global scope only. The zone of the credit caps is
 * `credits.timeZone` (`@krizaka/credits/settings`).
 */
export const couponSettings = {
  "coupons.enabled": flag("coupons", COUPON_DEFAULTS.enabled),
  "coupons.reservationMinutes": int("reservationMinutes", "minutes"),
  "coupons.attemptsPerAccountPerHour": int("attemptsPerAccountPerHour", "attempts"),
  "coupons.attemptsPerIpPerHour": int("attemptsPerIpPerHour", "attempts"),
  "coupons.minCodeLength": int("minCodeLength", "characters"),
  "coupons.generatedCodeLength": int("generatedCodeLength", "characters"),
  "coupons.maxPercentOff": int("maxPercentOff", "percent"),
  "coupons.refundRestoresUse": flag("coupons", COUPON_DEFAULTS.refundRestoresUse),
} as const satisfies Registry;

type Reader = (key: keyof typeof couponSettings) => boolean | number | undefined | Promise<boolean | number | undefined>;

/**
 * The module's settings as `createCoupons` takes them, from the product's accessor (`(key) => service.get(key, ctx)`).
 * A key the accessor does not know falls back to the default.
 */
export async function readCouponSettings(read: Reader): Promise<CouponSettings> {
  const number = async (key: keyof typeof COUPON_BOUNDS): Promise<number> => {
    const value = await read(`coupons.${key}`);
    return typeof value === "number" ? value : COUPON_DEFAULTS[key];
  };
  const bool = async (key: "enabled" | "refundRestoresUse"): Promise<boolean> => {
    const value = await read(`coupons.${key}`);
    return typeof value === "boolean" ? value : COUPON_DEFAULTS[key];
  };
  return {
    enabled: await bool("enabled"),
    reservationMinutes: await number("reservationMinutes"),
    attemptsPerAccountPerHour: await number("attemptsPerAccountPerHour"),
    attemptsPerIpPerHour: await number("attemptsPerIpPerHour"),
    minCodeLength: await number("minCodeLength"),
    generatedCodeLength: await number("generatedCodeLength"),
    maxPercentOff: await number("maxPercentOff"),
    refundRestoresUse: await bool("refundRestoresUse"),
  };
}

/** The limit the settings give the attempts action (hourly, per address and per account): `limits: (action) => action === COUPON_ATTEMPT_ACTION ? couponAttemptLimit(settings) : …`. */
export { COUPON_ATTEMPT_ACTION };
export const couponAttemptLimit = (s: Pick<CouponSettings, "attemptsPerAccountPerHour" | "attemptsPerIpPerHour">) => ({
  perIp: s.attemptsPerIpPerHour,
  perSubject: s.attemptsPerAccountPerHour,
  // @fixed: the settings are « per hour », so the window is an hour
  windowSeconds: 3600,
});
