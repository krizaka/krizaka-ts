import { getDateTimeFormat, localDay } from "@krizaka/intl";
import { format, getISODay, startOfISOWeek } from "date-fns";

/** The brief's week, in the shop's time zone. */
export interface BriefWeek {
  /** ISO week, `2026-W43`. */
  readonly week: string;
  /** Its Monday, `2026-10-19`. */
  readonly monday: string;
  /** The local date of the instant, `2026-10-22`. */
  readonly localDate: string;
  /** 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
  /** The local hour, 0–23. */
  readonly hour: number;
}

/** The local calendar date (`@krizaka/intl`'s `localDay`) and hour of an instant in a time zone. */
function localParts(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number } {
  const [year, month, day] = localDay(instant, timeZone).split("-").map(Number) as [number, number, number];
  const hour = Number(getDateTimeFormat("en-CA", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(instant));
  return { year, month, day, hour };
}

/** The week an instant falls in, for a shop in `timeZone` (America/Montreal…). */
export function weekOf(instant: Date, timeZone: string): BriefWeek {
  const { year, month, day, hour } = localParts(instant, timeZone);
  // Noon of the local date, read in the runtime's zone: only its calendar fields are used, so no DST edge applies.
  const local = new Date(year, month - 1, day, 12);
  return {
    week: format(local, "RRRR-'W'II"),
    monday: format(startOfISOWeek(local), "yyyy-MM-dd"),
    localDate: format(local, "yyyy-MM-dd"),
    weekday: getISODay(local),
    hour,
  };
}

export interface DueRule {
  /** 1 = Monday (default). */
  readonly weekday?: number;
  /** Local hour from which it is due (7 by default). */
  readonly hour?: number;
}

/**
 * Whether the brief is due now: on or after the rule's weekday and hour of this week, and not yet sent this week.
 * A scheduler runs hourly and asks; a missed Monday still sends on Tuesday (late, not never).
 */
export function isBriefDue(instant: Date, timeZone: string, lastSentWeek: string | null, rule: DueRule = {}): boolean {
  const { weekday: dueDay = 1, hour: dueHour = 7 } = rule;
  const now = weekOf(instant, timeZone);
  if (lastSentWeek === now.week) return false;
  return now.weekday > dueDay || (now.weekday === dueDay && now.hour >= dueHour);
}
