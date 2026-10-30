import type {
  ConnectAccountStatus,
  ConnectPayment,
  ConnectPaymentState,
  ConnectPort,
  DirectPaymentRequest,
} from "./connect";
import { rawCall } from "./http";
import { PAYMENTS_CODE, type PaymentsCode,PaymentsError } from "./port";

export interface ConnectAdapterConfig {
  /** The PLATFORM's secret key (sk_test_… in tests): the merchant is named per call by `Stripe-Account`. The library never reads env. */
  secretKey: string;
  fetch?: typeof fetch;
  apiBase?: string;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the processor's untyped JSON, narrowed below

const fail = (status: number, message: string, code: PaymentsCode) => new PaymentsError(status, message, code);

const positive = (n: number | undefined, what: string): void => {
  if (n !== undefined && (!Number.isSafeInteger(n) || n <= 0))
    throw fail(400, `${what} is a positive integer of minor units, got ${n}`, PAYMENTS_CODE.badMoney);
};

/** The merchant's account, read as the domain's status. */
export function accountStatusOf(a: Json): ConnectAccountStatus {
  const chargesEnabled = a.charges_enabled === true;
  const detailsSubmitted = a.details_submitted === true;
  return {
    accountId: String(a.id),
    chargesEnabled,
    detailsSubmitted,
    payoutsEnabled: a.payouts_enabled === true,
    state: chargesEnabled ? "active" : detailsSubmitted ? "restricted" : "pending",
  };
}

const STATES: Record<string, ConnectPaymentState> = {
  succeeded: "paid",
  requires_capture: "held",
  requires_action: "requires_action",
  requires_confirmation: "requires_action",
  requires_payment_method: "failed",
  canceled: "released",
};

const paymentOf = (pi: Json): ConnectPayment => ({
  paymentRef: String(pi.id),
  state: STATES[String(pi.status)] ?? "failed",
  amountMinor: pi.status === "succeeded" ? Number(pi.amount_received ?? pi.amount) : Number(pi.amount),
  currency: String(pi.currency),
});

/** Stripe Connect Standard over `fetch`: direct charges on the connected account, no SDK. */
export function connectAdapter(config: ConnectAdapterConfig): ConnectPort {
  async function call(
    method: "GET" | "POST",
    path: string,
    params: Record<string, unknown> = {},
    key?: string,
    account?: string,
  ): Promise<Json> {
    const { ok, status, json } = await rawCall(config, method, path, params, key, account);
    if (ok) return json;
    const error = json.error as { type?: string; message?: string } | undefined;
    const declined = status === 402 || error?.type === "card_error";
    throw fail(
      declined ? 402 : status >= 500 ? 502 : 422,
      error?.message ?? `The processor answered ${status}`,
      declined ? PAYMENTS_CODE.declined : PAYMENTS_CODE.processor,
    );
  }

  const intent = (accountId: string, ref: string) =>
    call("GET", `/v1/payment_intents/${ref}`, { expand: ["latest_charge"] }, undefined, accountId);

  return {
    async createAccount({ key, email, country, metadata }) {
      const a = await call(
        "POST",
        "/v1/accounts",
        { type: "standard", email, country: country.toUpperCase(), metadata },
        key,
      );
      return { accountId: String(a.id) };
    },
    async onboardingLink({ accountId, returnUrl, refreshUrl }) {
      const l = await call("POST", "/v1/account_links", {
        account: accountId,
        type: "account_onboarding",
        return_url: returnUrl,
        refresh_url: refreshUrl,
      });
      return { url: String(l.url), expiresAt: typeof l.expires_at === "number" ? new Date(l.expires_at * 1000) : null };
    },
    async accountStatus(accountId) {
      return accountStatusOf(await call("GET", `/v1/accounts/${accountId}`));
    },
    async createCustomer(accountId, { key, email, name }) {
      const c = await call("POST", "/v1/customers", { email, name }, key, accountId);
      return { customerId: String(c.id) };
    },
    async saveCard(accountId, { key, customerId }) {
      const s = await call(
        "POST",
        "/v1/setup_intents",
        { customer: customerId, usage: "off_session", payment_method_types: ["card"] },
        key,
        accountId,
      );
      return { setupRef: String(s.id), clientSecret: String(s.client_secret) };
    },
    async pay(accountId, r: DirectPaymentRequest) {
      positive(r.amountMinor, "An amount");
      const fee = r.applicationFeeMinor ?? 0;
      if (!Number.isSafeInteger(fee) || fee < 0 || fee >= r.amountMinor)
        throw fail(400, `The fee is a non-negative integer below the amount, got ${fee}`, PAYMENTS_CODE.badFee);
      const pi = await call(
        "POST",
        "/v1/payment_intents",
        {
          amount: r.amountMinor,
          currency: r.currency.toLowerCase(),
          customer: r.customerId,
          payment_method: r.paymentMethodRef,
          confirm: true,
          off_session: true,
          capture_method: r.mode === "hold" ? "manual" : "automatic",
          application_fee_amount: fee > 0 ? fee : undefined,
          description: r.description,
          metadata: r.metadata,
        },
        r.key,
        accountId,
      );
      return paymentOf(pi);
    },
    async capture(accountId, paymentRef, { key, amountMinor }) {
      positive(amountMinor, "An amount");
      const pi = await call(
        "POST",
        `/v1/payment_intents/${paymentRef}/capture`,
        { amount_to_capture: amountMinor },
        key,
        accountId,
      );
      return paymentOf(pi);
    },
    async release(accountId, paymentRef, { key }) {
      return paymentOf(await call("POST", `/v1/payment_intents/${paymentRef}/cancel`, {}, key, accountId));
    },
    async refund(accountId, paymentRef, { key, amountMinor }) {
      positive(amountMinor, "An amount");
      const pi = await intent(accountId, paymentRef);
      const charge = pi.latest_charge as Json | null;
      const paid = Number(charge?.amount_captured ?? 0);
      if (!charge || paid <= 0) throw fail(422, "Nothing was captured on this payment", PAYMENTS_CODE.noPayment);
      const left = paid - Number(charge.amount_refunded ?? 0);
      if ((amountMinor ?? left) > left)
        throw fail(
          422,
          `Cannot refund ${amountMinor}: only ${left} is left of ${paid} paid`,
          PAYMENTS_CODE.refundExceedsPaid,
        );
      const r = await call("POST", "/v1/refunds", { payment_intent: paymentRef, amount: amountMinor }, key, accountId);
      return { refundRef: String(r.id), amountRefunded: Number(r.amount), currency: String(r.currency) };
    },
  };
}
