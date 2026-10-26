/**
 * Date arithmetic for Krizaka backends. The « Krizaka first » dates rule refuses a date library in a package; this is the facade
 * it points to (krizaka-ts#76). Everything here works on the INSTANT: adding two hours adds 7 200 000 ms, whatever the server's
 * time zone and whatever its daylight-saving rules say. A « calendar day » in a person's zone is not arithmetic on an instant: ask
 * `@krizaka/intl`'s `localDay`.
 *
 * Missing function? Add it here first, never import the library next to it.
 */
export { addHours, addMinutes, addSeconds, differenceInMilliseconds, differenceInSeconds, isAfter, isBefore, subHours, subMinutes, subSeconds } from "date-fns";
