/**
 * Date arithmetic for Krizaka backends. The « Krizaka first » dates rule refuses a date library in a package; this is the facade
 * it points to (krizaka-ts#76). Everything here works on the INSTANT: adding two hours adds 7 200 000 ms, whatever the server's
 * time zone and whatever its daylight-saving rules say. A « calendar day » in a person's zone is not arithmetic on an instant: ask
 * `@krizaka/intl`'s `localDay`.
 *
 * Missing function? Add it here first, never import the library next to it.
 */
import { format, isValid, parse } from "date-fns";

export { addHours, addMinutes, addSeconds, differenceInMilliseconds, differenceInSeconds, isAfter, isBefore, subHours, subMinutes, subSeconds } from "date-fns";

/**
 * True when `value` is a real calendar date written `YYYY-MM-DD` (2026-02-30 is not). A calendar day has no zone and no
 * instant, so this is validation, not arithmetic. Use it instead of a hand-written `/^\d{4}-\d{2}-\d{2}$/`.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10) {
    return false;
  }
  const parsed = parse(value, "yyyy-MM-dd", new Date(0));
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
}

// Common shapes an app validates (email, URL, slug, phone, postal code), written once: the helpers the
// `no-hand-written-validation-regex` rule (@krizaka/config) points to. Missing one? Add it here first.
const EMAIL = /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@.]{2,}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const CA_POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

/** True for `name@domain.tld` (no spaces, one `@`, a dotted domain). Not a deliverability check. */
export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value);
}

/** True for an absolute `http:` or `https:` URL that the platform's URL parser accepts. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** True for a lowercase URL slug: letters and digits separated by single hyphens. */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value);
}

/** True for an international phone number in E.164 form (`+14185551234`). */
export function isE164Phone(value: unknown): value is string {
  return typeof value === "string" && E164.test(value);
}

/** True for a Canadian postal code (`H2T 1S6`, with or without the space). */
export function isCanadianPostalCode(value: unknown): value is string {
  return typeof value === "string" && CA_POSTAL.test(value);
}
