import { describe, expect, it } from "vitest";

import { privacySettings, retentionFromSettings, retentionKey } from "../src/settings";

describe("the retention as settings", () => {
  const fragment = privacySettings({ screening: { retentionDays: 365 }, "payment-history": { retentionDays: 90 } });

  it("declares privacy.retention.<purpose>Days per purpose, in days, with the product's default", () => {
    expect(Object.keys(fragment).sort()).toEqual([
      "privacy.retention.paymentHistoryDays",
      "privacy.retention.screeningDays",
    ]);
    expect(fragment["privacy.retention.screeningDays"]).toMatchObject({
      kind: "integer",
      default: 365,
      min: 1,
      max: 3650,
      unit: "days",
    });
    expect(retentionKey("payment-history")).toBe("privacy.retention.paymentHistoryDays");
    expect(retentionKey("access_notes")).toBe("privacy.retention.accessNotesDays");
  });

  it("refuses a purpose that is not well formed, or two that give the same key", () => {
    expect(() => privacySettings({ "Bad Purpose": { retentionDays: 1 } })).toThrow(/purpose/);
    expect(() => privacySettings({ "a-b": { retentionDays: 1 }, a_b: { retentionDays: 2 } })).toThrow(
      /same settings key/,
    );
  });

  it("reads a purpose's retention back for the privacy service", async () => {
    const values: Record<string, number> = { "privacy.retention.screeningDays": 30 };
    const retention = retentionFromSettings((key) => values[key]);
    expect(await retention("screening")).toBe(30);
    expect(await retention("marketing")).toBeUndefined();
  });
});
