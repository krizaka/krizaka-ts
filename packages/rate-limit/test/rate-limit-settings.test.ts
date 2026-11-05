import { describe, expect, it } from "vitest";

import { limitsFromSettings, rateLimitSettings } from "../src/settings";

describe("the limits as settings", () => {
  const fragment = rateLimitSettings({
    signIn: { perIp: 30, perSubject: 10, windowSeconds: 900 },
    me: { perIp: 600, windowSeconds: 3600 },
  });

  it("declares limits.<action>.perIp, .perSubject and .windowSeconds, with the product's defaults and bounds", () => {
    expect(Object.keys(fragment).sort()).toEqual([
      "limits.me.perIp",
      "limits.me.windowSeconds",
      "limits.signIn.perIp",
      "limits.signIn.perSubject",
      "limits.signIn.windowSeconds",
    ]);
    expect(fragment["limits.signIn.perIp"]).toMatchObject({ kind: "integer", default: 30, min: 1, unit: "hits" });
    expect(fragment["limits.signIn.windowSeconds"]).toMatchObject({
      kind: "integer",
      default: 900,
      min: 1,
      max: 86_400,
      unit: "seconds",
    });
  });

  it("refuses an action id that cannot sit in a settings key", () => {
    for (const bad of ["sign-in", "Sign", "1st", "a b", "x".repeat(41), ""])
      expect(() => rateLimitSettings({ [bad]: { windowSeconds: 60 } }), bad).toThrow(RangeError);
  });

  it("reads an action's limits back for the limiter, leaving out what the action does not declare", async () => {
    const values: Record<string, number> = {
      "limits.signIn.perIp": 30,
      "limits.signIn.perSubject": 10,
      "limits.signIn.windowSeconds": 900,
      "limits.me.perIp": 600,
      "limits.me.windowSeconds": 3600,
    };
    const limits = limitsFromSettings((key) => values[key]);
    expect(await limits("signIn")).toEqual({ perIp: 30, perSubject: 10, windowSeconds: 900 });
    expect(await limits("me")).toEqual({ perIp: 600, windowSeconds: 3600 });
    expect(await limits("unknown")).toBeUndefined();
  });

  it("declares the global ceiling and its window with bounds from 1, and reads them back", async () => {
    const withGlobal = rateLimitSettings({
      subscribe: { perIp: 5, windowSeconds: 600, global: 5000, globalWindowSeconds: 3600 },
    });
    expect(withGlobal["limits.subscribe.global"]).toMatchObject({
      kind: "integer",
      default: 5000,
      min: 1,
      unit: "hits",
    });
    expect(withGlobal["limits.subscribe.globalWindowSeconds"]).toMatchObject({ default: 3600, min: 1, max: 86_400 });
    const values: Record<string, number> = {
      "limits.subscribe.perIp": 5,
      "limits.subscribe.windowSeconds": 600,
      "limits.subscribe.global": 5000,
      "limits.subscribe.globalWindowSeconds": 3600,
    };
    expect(await limitsFromSettings((key) => values[key])("subscribe")).toEqual({
      perIp: 5,
      windowSeconds: 600,
      global: 5000,
      globalWindowSeconds: 3600,
    });
  });

  it("refuses a global of 0 or without its window", () => {
    expect(() => rateLimitSettings({ a: { windowSeconds: 60, global: 0, globalWindowSeconds: 60 } })).toThrow(
      RangeError,
    );
    expect(() => rateLimitSettings({ a: { windowSeconds: 60, global: 5 } })).toThrow(RangeError);
    expect(() => rateLimitSettings({ a: { windowSeconds: 60, globalWindowSeconds: 60 } })).toThrow(RangeError);
  });
});
