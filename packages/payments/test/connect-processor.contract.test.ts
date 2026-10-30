import { describe, expect, it } from "vitest";

import { connectAdapter } from "../src/index";

/**
 * The contract against the processor's TEST mode, opt-in: set PAYMENTS_CONTRACT_KEY to a test-mode key (it must start with `sk_test_`;
 * anything else is ignored, so a live key can never run here, and default CI sets nothing). It creates a Standard test account and checks
 * that the objects the adapter reads still have the shapes it expects.
 */
const candidate = process.env.PAYMENTS_CONTRACT_KEY ?? "";
const enabled = candidate.startsWith("sk_test_");

describe.runIf(enabled)("processor test mode: Connect Standard", () => {
  const adapter = connectAdapter({ secretKey: candidate });
  const run = `ct-${Date.now()}`;

  it("creates a Standard account, an onboarding link and reads a not-yet-active status", async () => {
    const { accountId } = await adapter.createAccount({ key: run, email: "contract@example.com", country: "CA" });
    expect(accountId).toMatch(/^acct_/);
    const link = await adapter.onboardingLink({
      accountId,
      returnUrl: "https://example.com/return",
      refreshUrl: "https://example.com/refresh",
    });
    expect(link.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
    expect(["pending", "restricted"]).toContain((await adapter.accountStatus(accountId)).state);
  });

  it("refuses a payment on an account that cannot charge, with a typed error", async () => {
    const { accountId } = await adapter.createAccount({
      key: `${run}-b`,
      email: "contract-b@example.com",
      country: "CA",
    });
    await expect(
      adapter.pay(accountId, {
        key: `${run}-pay`,
        customerId: "cus_missing",
        paymentMethodRef: "pm_card_visa",
        amountMinor: 500,
        currency: "CAD",
        mode: "hold",
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^PAYMENTS_/) });
  });
});

describe("the opt-in guard", () => {
  it("runs only for a test-mode key", () => {
    expect(enabled).toBe(candidate.startsWith("sk_test_"));
    expect(enabled && candidate.startsWith("sk_live_")).toBe(false);
  });
});
