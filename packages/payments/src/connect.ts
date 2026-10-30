/**
 * The CONNECT port: a product whose customers are merchants (a shop that takes its own clients' payments). Each merchant has its
 * own processor account (Stripe Connect Standard: the merchant stays the merchant of record, the money never transits Krizaka);
 * charges are direct charges ON that account. Money is integer minor units. No card data crosses this port: a card is saved by the
 * processor's own form (the `clientSecret` goes to the browser) and used afterwards through its reference.
 */
/** What the product reads of a merchant's account. `active` = it can charge; `restricted` = it started but cannot charge; else `pending`. */
export interface ConnectAccountStatus {
  accountId: string;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  state: "pending" | "active" | "restricted";
}

/** A payment's state at the processor, in the domain's words. `held` = authorised, not captured yet. */
export type ConnectPaymentState = "paid" | "held" | "requires_action" | "failed" | "released";

export interface ConnectPayment {
  paymentRef: string;
  state: ConnectPaymentState;
  amountMinor: number;
  currency: string;
}

export interface DirectPaymentRequest {
  /** Makes the payment idempotent: a retry with the same key never charges twice. Stable per thing sold (a booking id). */
  key: string;
  customerId: string;
  /** The saved card (`ConnectPort.saveCard` then the processor's reference). */
  paymentMethodRef: string;
  /** Positive integer minor units. */
  amountMinor: number;
  currency: string;
  /** `capture`: taken now. `hold`: authorised, taken later by `capture` (a deposit kept as a guarantee) or released by `release`. */
  mode: "capture" | "hold";
  /** The platform's fee, integer minor units; 0 (or omitted) takes none. Never above the amount. */
  applicationFeeMinor?: number;
  description?: string;
  metadata?: Record<string, string>;
}

export interface ConnectPort {
  /** Creates the merchant's (empty) account. Idempotent per key. */
  createAccount(input: {
    key: string;
    email: string;
    country: string;
    metadata?: Record<string, string>;
  }): Promise<{ accountId: string }>;
  /** The processor-hosted onboarding page. The two URLs are the product's. */
  onboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string; expiresAt: Date | null }>;
  accountStatus(accountId: string): Promise<ConnectAccountStatus>;
  /** A customer ON the merchant's account (the merchant's client). */
  createCustomer(
    accountId: string,
    input: { key: string; email: string; name?: string },
  ): Promise<{ customerId: string }>;
  /** Starts saving a card: the browser confirms it with `clientSecret` through the processor's own form. */
  saveCard(
    accountId: string,
    input: { key: string; customerId: string },
  ): Promise<{ setupRef: string; clientSecret: string }>;
  /** A direct charge or a deposit hold on the merchant's account. */
  pay(accountId: string, request: DirectPaymentRequest): Promise<ConnectPayment>;
  /** Takes a held payment, all or part of it (never more than held). */
  capture(accountId: string, paymentRef: string, input: { key: string; amountMinor?: number }): Promise<ConnectPayment>;
  /** Releases a held payment: nothing is taken. */
  release(accountId: string, paymentRef: string, input: { key: string }): Promise<ConnectPayment>;
  /** Gives back all or part of a captured payment; refused above what is left (paid minus already refunded). */
  refund(
    accountId: string,
    paymentRef: string,
    input: { key: string; amountMinor?: number },
  ): Promise<{ refundRef: string; amountRefunded: number; currency: string }>;
}

/** A notification of the Connect webhook, in the domain's words, always with the merchant's account. */
export type ConnectEvent =
  | { id: string; type: "account_updated"; accountId: string; status: ConnectAccountStatus }
  | {
      id: string;
      type: "payment_paid";
      accountId: string;
      paymentRef: string;
      amountMinor: number;
      currency: string;
      metadata: Record<string, string>;
    }
  | {
      id: string;
      type: "payment_held";
      accountId: string;
      paymentRef: string;
      amountMinor: number;
      currency: string;
      metadata: Record<string, string>;
    }
  | { id: string; type: "payment_released"; accountId: string; paymentRef: string; metadata: Record<string, string> }
  | {
      id: string;
      type: "payment_refunded";
      accountId: string;
      paymentRef: string;
      /** CUMULATIVE: all refunds of the payment so far (a replay sets the same total). */
      amountRefunded: number;
      amountPaid: number;
      currency: string;
      metadata: Record<string, string>;
    }
  | { id: string; type: "ignored" };

/**
 * The only writers of `paid` / `held` / `released` / `refunded` and of the account's state: the product's handlers, called once per
 * verified notification. A route never writes these itself.
 */
export type ConnectHandlers = {
  [T in Exclude<ConnectEvent["type"], "ignored">]?: (
    event: Extract<ConnectEvent, { type: T }>,
  ) => Promise<void | "ignored">;
};
