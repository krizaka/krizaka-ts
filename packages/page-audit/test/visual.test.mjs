import { describe, expect, it } from "vitest";

import {
  FROZEN_TIME,
  settleForShot,
  shotOptions,
  VIEWPORTS,
  visualContextOptions,
  visualMatrix,
} from "../src/visual.mjs";

describe("visualMatrix", () => {
  it("gives a name to every viewport × theme cell", () => {
    const names = visualMatrix({ name: "pricing" }).map((c) => c.snapshot);
    expect(names).toEqual([
      "pricing-desktop-light.png",
      "pricing-desktop-dark.png",
      "pricing-phone-light.png",
      "pricing-phone-dark.png",
    ]);
  });
  it("keeps only the viewports a journey asks for, and names the first paint apart", () => {
    const cells = visualMatrix({ name: "home", viewports: ["phone"], firstPaint: true });
    expect(cells.map((c) => c.snapshot)).toEqual([
      "home-first-paint-phone-light.png",
      "home-first-paint-phone-dark.png",
    ]);
  });
  it("refuses an unknown viewport", () => {
    expect(() => visualMatrix({ name: "x", viewports: ["tv"] })).toThrow(/unknown viewport/);
  });
});

describe("visualContextOptions", () => {
  it("fixes what moves between two runs", () => {
    const o = visualContextOptions({ size: VIEWPORTS.phone, theme: "dark" });
    expect(o).toMatchObject({
      reducedMotion: "reduce",
      colorScheme: "dark",
      timezoneId: "America/Toronto",
      serviceWorkers: "block",
      javaScriptEnabled: true,
    });
  });
  it("can turn JavaScript off for the first paint", () => {
    expect(visualContextOptions({ size: VIEWPORTS.phone, theme: "light", javaScript: false }).javaScriptEnabled).toBe(
      false,
    );
  });
});

describe("shotOptions", () => {
  it("masks the live values through the page's locators", () => {
    const page = { locator: (s) => ({ s }) };
    expect(shotOptions({ page, mask: ["[data-live]"] }).mask).toEqual([{ s: "[data-live]" }]);
    expect(shotOptions({}).mask).toBeUndefined();
  });
  it("freezes time on a fixed instant", () => {
    expect(new Date(FROZEN_TIME).toISOString()).toBe(FROZEN_TIME);
  });
});

describe("settleForShot", () => {
  it("never runs a script in a page whose JavaScript is off (it would hang)", async () => {
    const calls = [];
    const page = { addStyleTag: async () => calls.push("style"), evaluate: async () => calls.push("evaluate") };
    await settleForShot(page, { javaScript: false });
    expect(calls).toEqual([]);
  });
  it("freezes the page and waits for the faces when scripts run", async () => {
    const calls = [];
    const page = {
      addStyleTag: async () => calls.push("style"),
      evaluate: async () => calls.push("evaluate"),
      waitForFunction: async () => calls.push("settled"),
    };
    await settleForShot(page);
    expect(calls).toEqual(["style", "evaluate", "settled", "evaluate"]);
  });
});
