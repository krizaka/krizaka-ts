import { type CouponAdmin, makeAdmin } from "./admin";
import {
  type Applied,
  type ApplyInput,
  type CreditRedemption,
  makeFlows,
  type RedeemInput,
  type Validation,
} from "./flows";
import { type CouponsDeps, makeKernel } from "./kernel";
import type { Actor, Query } from "./port";
import type { CheckoutContext } from "./rules";

/** The coupons of a product (ADR-002 §5.1). Every function takes the `Query` it works through: pass `tx` to join a unit of work. */
export interface Coupons {
  /** Read-only: what a code would give, or why not. Counts one attempt on the limiter, before any lookup. Never reserves. */
  validate(query: Query, code: string, context: CheckoutContext): Promise<Validation>;
  /** Reserves a use of a discount code for a checkout (a short transaction: no network inside), idempotent by key. */
  apply(tx: Query, input: ApplyInput): Promise<Applied>;
  /** Stores the provider's session on the reservation and makes it outlive the session. */
  attachCheckout(tx: Query, redemptionId: string, checkoutRef: string, sessionExpiresAt?: Date | null): Promise<void>;
  /** On the payment event, in its transaction: confirms the use once. A payment after the release is confirmed anyway (`overLimit`). */
  redeem(tx: Query, input: RedeemInput): Promise<"confirmed" | "already" | "unknown">;
  /** Frees an unpaid reservation (a failed session, an expired checkout). `false` when there was none to free. */
  release(tx: Query, ref: { redemptionId?: string; checkoutRef?: string }): Promise<boolean>;
  /** The sweeper: frees the reservations past their deadline. */
  releaseExpired(tx: Query): Promise<number>;
  /** A refund (cumulative amount). Gives the use back only on a full refund with `coupons.refundRestoresUse`. */
  refund(
    tx: Query,
    input: { paymentRef?: string | null; invoiceRef?: string | null; amountRefunded: number },
  ): Promise<"refunded" | "already" | "unknown">;
  /** Redeems a credit code: the same rules, then a capped grant in the credits ledger, in the same transaction. Idempotent by key. */
  redeemCredit(
    tx: Query,
    input: { code: string; accountId: string; idempotencyKey: string; ip?: string | null; hasPaidBefore?: boolean },
  ): Promise<CreditRedemption>;
  /** The admin revokes a credit redemption: what is left of its grant is written off; credits already spent are never taken back. */
  revoke(tx: Query, actor: Actor, redemptionId: string): Promise<void>;
  admin: CouponAdmin;
}

/**
 * The coupons of a product.
 * @param deps the clock, the settings, the trail, the limiter, and optionally the credits ledger, the outbox, the store
 */
export function createCoupons(deps: CouponsDeps): Coupons {
  const kernel = makeKernel(deps);
  return { ...makeFlows(kernel), admin: makeAdmin(kernel) };
}
