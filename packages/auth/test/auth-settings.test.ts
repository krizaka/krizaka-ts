import { describe, expect, it } from "vitest";

import { PASSWORD_RESET_MAX_MINUTES, PASSWORD_RESET_MIN_MINUTES, PASSWORD_RESET_TTL_MINUTES } from "../src";
import { authSettings } from "../src/settings";

describe("the settings of auth", () => {
  it("makes the session lifetime a setting: two weeks, one day to ninety", () => {
    expect(authSettings["auth.sessionDays"]).toMatchObject({
      kind: "integer",
      default: 14,
      min: 1,
      max: 90,
      unit: "days",
    });
  });

  it("makes the reset link's lifetime a setting with the bounds the account adapter enforces", () => {
    expect(authSettings["auth.passwordResetMinutes"]).toMatchObject({
      kind: "integer",
      default: PASSWORD_RESET_TTL_MINUTES,
      min: PASSWORD_RESET_MIN_MINUTES,
      max: PASSWORD_RESET_MAX_MINUTES,
      unit: "minutes",
    });
  });
});
