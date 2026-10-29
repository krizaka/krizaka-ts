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
