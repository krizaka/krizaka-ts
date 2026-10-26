import { describe, expect, it } from "vitest";

import { addHours, addMinutes, addSeconds, differenceInMilliseconds, differenceInSeconds, isAfter, isBefore, subHours, subMinutes, subSeconds } from "../src";

const NOON = new Date("2026-10-26T12:00:00.000Z");

describe("arithmetic on an instant", () => {
  it("adds and subtracts seconds, minutes and hours exactly", () => {
    expect(addSeconds(NOON, 90).toISOString()).toBe("2026-10-26T12:01:30.000Z");
    expect(addMinutes(NOON, 15).toISOString()).toBe("2026-10-26T12:15:00.000Z");
    expect(addHours(NOON, 36).toISOString()).toBe("2026-10-28T00:00:00.000Z");
    expect(subSeconds(NOON, 30).toISOString()).toBe("2026-10-26T11:59:30.000Z");
    expect(subMinutes(NOON, 15).toISOString()).toBe("2026-10-26T11:45:00.000Z");
    expect(subHours(NOON, 12).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("does not move with daylight saving: 14 days of 24 hours across the autumn change is an exact number of milliseconds", () => {
    const later = addHours(NOON, 14 * 24);
    expect(differenceInMilliseconds(later, NOON)).toBe(14 * 24 * 3_600_000);
    expect(later.toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });

  it("does not change its argument", () => {
    const copy = new Date(NOON);
    addHours(copy, 5);
    expect(copy.toISOString()).toBe(NOON.toISOString());
  });
});

describe("gaps and order", () => {
  it("measures the gap, rounding toward zero in whole seconds", () => {
    expect(differenceInSeconds(addSeconds(NOON, 59), NOON)).toBe(59);
    expect(differenceInSeconds(addMinutes(NOON, 1), NOON)).toBe(60);
    expect(differenceInMilliseconds(NOON, addSeconds(NOON, 2))).toBe(-2000);
  });

  it("orders two instants", () => {
    expect(isBefore(NOON, addSeconds(NOON, 1))).toBe(true);
    expect(isAfter(NOON, addSeconds(NOON, 1))).toBe(false);
    expect(isBefore(NOON, NOON)).toBe(false);
  });
});
