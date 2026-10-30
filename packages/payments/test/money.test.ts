import { describe, expect, it } from "vitest";

import { addMoney, formatMoney, money, PAYMENTS_CODE } from "../src/index";

describe("money is integer minor units with a currency", () => {
  it("makes an amount with a lowercase currency", () => {
    expect(money(1149, "CAD")).toEqual({ amountMinor: 1149, currency: "cad" });
    expect(money(0, "usd")).toEqual({ amountMinor: 0, currency: "usd" });
  });
  it("refuses floats, negatives, unsafe integers and bad currencies", () => {
    for (const bad of [
      () => money(9.99, "cad"),
      () => money(-1, "cad"),
      () => money(Number.MAX_SAFE_INTEGER + 1, "cad"),
      () => money(Number.NaN, "cad"),
      () => money(1, "dollars"),
      () => money(1, ""),
    ]) {
      expect(bad).toThrow(expect.objectContaining({ code: PAYMENTS_CODE.badMoney, status: 400 }));
    }
  });
  it("adds amounts of one currency and refuses mixing", () => {
    expect(addMoney(money(100, "cad"), money(250, "CAD"))).toEqual({ amountMinor: 350, currency: "cad" });
    expect(() => addMoney(money(1, "cad"), money(1, "usd"))).toThrow(/Cannot add/);
  });
  it("formats in each locale's convention, decimals only when there are some, any currency's exponent", () => {
    expect(formatMoney(money(3900, "cad"), "en")).toBe("$39");
    expect(formatMoney(money(3900, "cad"), "fr").replace(/\s/g, " ")).toBe("39 $");
    expect(formatMoney(money(999, "cad"), "en")).toBe("$9.99");
    expect(formatMoney(money(5, "jpy"), "en")).toMatch(/5/);
    expect(formatMoney(money(5, "jpy"), "en")).not.toMatch(/0\.05/);
  });
});
