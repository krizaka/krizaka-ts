import { describe, expect, it } from "vitest";

import { OUTBOX_BOUNDS, OUTBOX_DEFAULTS } from "../src";
import { outboxSettings, readOutboxSettings } from "../src/settings";

describe("the settings of the outbox", () => {
  it("are the registry fragment: outbox.batchSize, leaseSeconds, maxAttempts, backoffSeconds, backoffMaxSeconds, retentionDays, with the code's defaults and bounds", () => {
    expect(outboxSettings["outbox.batchSize"]).toMatchObject({ kind: "integer", default: 50, min: 1, max: 500 });
    expect(outboxSettings["outbox.leaseSeconds"]).toMatchObject({ default: 60, min: 10, max: 3600 });
    expect(outboxSettings["outbox.maxAttempts"]).toMatchObject({ default: 8, min: 1, max: 50 });
    expect(outboxSettings["outbox.backoffSeconds"]).toMatchObject({ default: 30, min: 1, max: 3600 });
    for (const key of Object.keys(OUTBOX_DEFAULTS) as (keyof typeof OUTBOX_DEFAULTS)[]) {
      expect(outboxSettings[`outbox.${key}`]).toMatchObject({ default: OUTBOX_DEFAULTS[key], min: OUTBOX_BOUNDS[key][0], max: OUTBOX_BOUNDS[key][1] });
    }
  });

  it("are read back for the outbox, falling back to the default for a key nobody knows", async () => {
    const values: Record<string, number> = { "outbox.batchSize": 100, "outbox.maxAttempts": 3 };
    expect(await readOutboxSettings((key) => values[key])).toEqual({ ...OUTBOX_DEFAULTS, batchSize: 100, maxAttempts: 3 });
  });
});
