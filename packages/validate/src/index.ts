/**
 * The common facts an app validates, written once. A hand-written pattern for an email, a URL, a slug or a phone number is
 * refused by the `no-hand-written-validation-regex` rule (`@krizaka/config`): use these. Missing one? Add it here first.
 * A calendar date (`YYYY-MM-DD`) is `isIsoDate` of `@krizaka/time`.
 */

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
