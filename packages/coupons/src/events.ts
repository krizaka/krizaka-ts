import { createHash } from "node:crypto";

/** The topic the coupons' events are appended to on the outbox. */
export const COUPONS_TOPIC = "coupons";

export const COUPON_EVENT = {
  redeemed: "evt.coupon.redeemed.v1",
  released: "evt.coupon.released.v1",
  refunded: "evt.coupon.refunded.v1",
  exhausted: "evt.coupon.exhausted.v1",
} as const;

/** A stable UUID (version 5 shaped) from a seed: the same fact announced twice is one outbox message. */
export function uuidOf(seed: string): string {
  const h = createHash("sha256").update(`krizaka.coupons:${seed}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const nullableString = { type: ["string", "null"] } as const;
const nullableInt = { type: ["integer", "null"] } as const;

/** The JSON Schema of each event's payload. `evt.coupon.redeemed.v1` is the hook of the later commissions module: it carries the partner and the amounts. */
export const COUPON_EVENT_SCHEMAS = {
  [COUPON_EVENT.redeemed]: {
    type: "object",
    additionalProperties: false,
    required: ["redemptionId", "couponId", "kind", "purpose", "partnerId", "amountPaidMinor", "amountDiscountMinor", "currency", "credits", "overLimit"],
    properties: {
      redemptionId: { type: "string" },
      couponId: { type: "string" },
      kind: { enum: ["discount", "credit"] },
      purpose: { enum: ["partner", "promo", "demo", "support"] },
      partnerId: nullableString,
      amountPaidMinor: nullableInt,
      amountDiscountMinor: nullableInt,
      currency: nullableString,
      credits: nullableInt,
      overLimit: { type: "boolean" },
    },
  },
  [COUPON_EVENT.released]: { type: "object", additionalProperties: false, required: ["redemptionId", "couponId"], properties: { redemptionId: { type: "string" }, couponId: { type: "string" } } },
  [COUPON_EVENT.refunded]: {
    type: "object",
    additionalProperties: false,
    required: ["redemptionId", "couponId", "partnerId", "amountRefundedMinor", "currency", "useRestored"],
    properties: { redemptionId: { type: "string" }, couponId: { type: "string" }, partnerId: nullableString, amountRefundedMinor: { type: "integer", minimum: 0 }, currency: nullableString, useRestored: { type: "boolean" } },
  },
  [COUPON_EVENT.exhausted]: { type: "object", additionalProperties: false, required: ["couponId", "partnerId"], properties: { couponId: { type: "string" }, partnerId: nullableString } },
} as const;
