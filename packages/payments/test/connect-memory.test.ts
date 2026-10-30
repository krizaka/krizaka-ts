import { describe, expect, it } from "vitest";

import { memoryConnect, PAYMENTS_CODE, PaymentsError } from "../src/index";

async function shop() {
  const connect = memoryConnect();
  const { accountId } = await connect.createAccount({ key: "shop", email: "a@b.c", country: "CA" });
  connect.activate(accountId);
  const { customerId } = await connect.createCustomer(accountId, { key: "c", email: "c@b.c" });
  return { connect, accountId, customerId };
}
type Shop = Awaited<ReturnType<typeof shop>>;
const request = (s: Shop, over: Partial<Parameters<Shop["connect"]["pay"]>[1]> = {}) => ({
  key: "booking-1",
  customerId: s.customerId,
  paymentMethodRef: "pm_1",
  amountMinor: 5000,
  currency: "CAD",
  mode: "hold" as const,
  ...over,
});
const reason = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? r.reason : undefined);

describe("a deposit capture racing a cancellation", () => {
  it("lets the capture win and refuses the release with a typed error", async () => {
    const s = await shop();
    const { paymentRef } = await s.connect.pay(s.accountId, request(s));
    const [cap, rel] = await Promise.allSettled([
      s.connect.capture(s.accountId, paymentRef, { key: "cap" }),
      s.connect.release(s.accountId, paymentRef, { key: "rel" }),
    ]);
    expect(cap.status).toBe("fulfilled");
    expect(reason(rel)).toBeInstanceOf(PaymentsError);
    expect(reason(rel)).toMatchObject({ code: PAYMENTS_CODE.notHeld });
    expect(s.connect.payment(paymentRef)).toMatchObject({ state: "paid", captured: 5000 });
  });

  it("lets the release win and refuses the capture with a typed error", async () => {
    const s = await shop();
    const { paymentRef } = await s.connect.pay(s.accountId, request(s));
    const [rel, cap] = await Promise.allSettled([
      s.connect.release(s.accountId, paymentRef, { key: "rel" }),
      s.connect.capture(s.accountId, paymentRef, { key: "cap" }),
    ]);
    expect(rel.status).toBe("fulfilled");
    expect(reason(cap)).toMatchObject({ code: PAYMENTS_CODE.notHeld });
    expect(s.connect.payment(paymentRef)).toMatchObject({ state: "released", captured: 0 });
  });

  it("answers a retry of the winning call with the same result, never a second transition", async () => {
    const s = await shop();
    const { paymentRef } = await s.connect.pay(s.accountId, request(s));
    const first = await s.connect.capture(s.accountId, paymentRef, { key: "cap" });
    expect(await s.connect.capture(s.accountId, paymentRef, { key: "cap" })).toEqual(first);
  });
});

describe("the in-memory adapter keeps the real one's rules", () => {
  it("does not charge before onboarding is done, and never twice for one key", async () => {
    const connect = memoryConnect();
    const { accountId } = await connect.createAccount({ key: "k", email: "a@b.c", country: "CA" });
    const req = {
      key: "p",
      customerId: "cus_1",
      paymentMethodRef: "pm",
      amountMinor: 100,
      currency: "CAD",
      mode: "capture" as const,
    };
    await expect(connect.pay(accountId, req)).rejects.toMatchObject({ code: PAYMENTS_CODE.badAccount });
    connect.activate(accountId);
    const first = await connect.pay(accountId, req);
    expect(await connect.pay(accountId, req)).toEqual(first);
  });

  it("caps refunds at paid minus already refunded", async () => {
    const s = await shop();
    const pay = await s.connect.pay(s.accountId, request(s, { mode: "capture", amountMinor: 1000 }));
    await s.connect.refund(s.accountId, pay.paymentRef, { key: "r1", amountMinor: 600 });
    await expect(s.connect.refund(s.accountId, pay.paymentRef, { key: "r2", amountMinor: 500 })).rejects.toMatchObject({
      code: PAYMENTS_CODE.refundExceedsPaid,
    });
    expect((await s.connect.refund(s.accountId, pay.paymentRef, { key: "r3" })).amountRefunded).toBe(400);
  });

  it("refuses a fee not below the amount, and a payment of another account", async () => {
    const s = await shop();
    await expect(
      s.connect.pay(s.accountId, request(s, { key: "f", mode: "capture", amountMinor: 100, applicationFeeMinor: 100 })),
    ).rejects.toMatchObject({ code: PAYMENTS_CODE.badFee });
    const { paymentRef } = await s.connect.pay(s.accountId, request(s));
    const other = await s.connect.createAccount({ key: "other", email: "x@y.z", country: "CA" });
    await expect(s.connect.release(other.accountId, paymentRef, { key: "x" })).rejects.toMatchObject({
      code: PAYMENTS_CODE.noPayment,
    });
  });
});
