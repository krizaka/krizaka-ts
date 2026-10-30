import type { ConnectAccountStatus, ConnectPayment, ConnectPort } from "./connect";
import { PAYMENTS_CODE, type PaymentsCode, PaymentsError } from "./port";

/** The in-memory Connect processor of the apps' tests: the same port as `connectAdapter`, the same refusals, no network. */
export interface MemoryConnect extends ConnectPort {
  /** Makes a merchant's account able to charge (what finishing the processor's onboarding does). */
  activate(accountId: string): void;
  /** What the processor holds of a payment, or null. */
  payment(paymentRef: string): (ConnectPayment & { captured: number; refunded: number; accountId: string }) | null;
}

type Held = ConnectPayment & { captured: number; refunded: number; accountId: string };

const refuse = (status: number, message: string, code: PaymentsCode) => new PaymentsError(status, message, code);

const positive = (n: number | undefined, what: string): void => {
  if (n !== undefined && (!Number.isSafeInteger(n) || n <= 0))
    throw refuse(400, `${what} is a positive integer of minor units, got ${n}`, PAYMENTS_CODE.badMoney);
};

const view = (p: Held): ConnectPayment => ({
  paymentRef: p.paymentRef,
  state: p.state,
  amountMinor: p.state === "paid" ? p.captured : p.amountMinor,
  currency: p.currency,
});

export function memoryConnect(): MemoryConnect {
  let n = 0;
  const id = (prefix: string) => `${prefix}_mem${++n}`;
  const accounts = new Map<string, ConnectAccountStatus>();
  const payments = new Map<string, Held>();
  const answers = new Map<string, unknown>();

  /** A key answers its first result once (idempotency). The body is synchronous: it is the whole transition, so racing calls are serialised. */
  const step = <T>(scope: string, key: string, run: () => T): Promise<T> => {
    const at = `${scope}:${key}`;
    if (answers.has(at)) return Promise.resolve(answers.get(at) as T);
    try {
      const result = run();
      answers.set(at, result);
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const account = (accountId: string): ConnectAccountStatus => {
    const found = accounts.get(accountId);
    if (!found) throw refuse(422, `No such account ${accountId}`, PAYMENTS_CODE.badAccount);
    return found;
  };
  const held = (accountId: string, paymentRef: string): Held => {
    account(accountId);
    const found = payments.get(paymentRef);
    if (found?.accountId !== accountId) throw refuse(422, `No such payment ${paymentRef}`, PAYMENTS_CODE.noPayment);
    return found;
  };
  const mustBeHeld = (p: Held): void => {
    if (p.state !== "held") throw refuse(409, `Payment ${p.paymentRef} is ${p.state}, not held`, PAYMENTS_CODE.notHeld);
  };

  return {
    activate(accountId) {
      const a = account(accountId);
      accounts.set(accountId, {
        ...a,
        chargesEnabled: true,
        detailsSubmitted: true,
        payoutsEnabled: true,
        state: "active",
      });
    },
    payment: (ref) => payments.get(ref) ?? null,
    createAccount: ({ key }) =>
      step("account", key, () => {
        const accountId = id("acct");
        accounts.set(accountId, {
          accountId,
          chargesEnabled: false,
          detailsSubmitted: false,
          payoutsEnabled: false,
          state: "pending",
        });
        return { accountId };
      }),
    async onboardingLink({ accountId }) {
      account(accountId);
      return { url: `https://connect.memory.test/setup/${accountId}`, expiresAt: null };
    },
    async accountStatus(accountId) {
      return account(accountId);
    },
    createCustomer: (accountId, { key }) =>
      step(`customer:${accountId}`, key, () => {
        account(accountId);
        return { customerId: id("cus") };
      }),
    saveCard: (accountId, { key }) =>
      step(`card:${accountId}`, key, () => {
        account(accountId);
        const setupRef = id("seti");
        return { setupRef, clientSecret: `${setupRef}_secret` };
      }),
    pay: (accountId, r) =>
      step(`pay:${accountId}`, r.key, () => {
        if (account(accountId).state !== "active")
          throw refuse(422, "The account cannot charge yet", PAYMENTS_CODE.badAccount);
        positive(r.amountMinor, "An amount");
        const fee = r.applicationFeeMinor ?? 0;
        if (!Number.isSafeInteger(fee) || fee < 0 || fee >= r.amountMinor)
          throw refuse(400, `The fee is a non-negative integer below the amount, got ${fee}`, PAYMENTS_CODE.badFee);
        const paid = r.mode === "capture";
        const p: Held = {
          paymentRef: id("pi"),
          accountId,
          state: paid ? "paid" : "held",
          amountMinor: r.amountMinor,
          currency: r.currency.toLowerCase(),
          captured: paid ? r.amountMinor : 0,
          refunded: 0,
        };
        payments.set(p.paymentRef, p);
        return view(p);
      }),
    capture: (accountId, paymentRef, { key, amountMinor }) =>
      step(`capture:${accountId}:${paymentRef}`, key, () => {
        positive(amountMinor, "An amount");
        const p = held(accountId, paymentRef);
        mustBeHeld(p);
        if ((amountMinor ?? p.amountMinor) > p.amountMinor)
          throw refuse(422, `Cannot capture above the ${p.amountMinor} held`, PAYMENTS_CODE.badMoney);
        p.state = "paid";
        p.captured = amountMinor ?? p.amountMinor;
        return view(p);
      }),
    release: (accountId, paymentRef, { key }) =>
      step(`release:${accountId}:${paymentRef}`, key, () => {
        const p = held(accountId, paymentRef);
        mustBeHeld(p);
        p.state = "released";
        return view(p);
      }),
    refund: (accountId, paymentRef, { key, amountMinor }) =>
      step(`refund:${accountId}:${paymentRef}`, key, () => {
        positive(amountMinor, "An amount");
        const p = held(accountId, paymentRef);
        if (p.captured <= 0) throw refuse(422, "Nothing was captured on this payment", PAYMENTS_CODE.noPayment);
        const left = p.captured - p.refunded;
        if ((amountMinor ?? left) > left)
          throw refuse(
            422,
            `Cannot refund ${amountMinor}: only ${left} is left of ${p.captured} paid`,
            PAYMENTS_CODE.refundExceedsPaid,
          );
        const amountRefunded = amountMinor ?? left;
        p.refunded += amountRefunded;
        return { refundRef: id("re"), amountRefunded, currency: p.currency };
      }),
  };
}
