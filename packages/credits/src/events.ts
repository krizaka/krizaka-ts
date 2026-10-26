import { createHash } from "node:crypto";

import type { Query } from "@krizaka/db";

/** The topic the ledger's events are appended to on the outbox. */
export const CREDITS_TOPIC = "credits";

/** Event types: the names of `krizaka-billing-api`, so a TypeScript product and a Java service speak alike. */
export const CREDIT_EVENT = { granted: "evt.credit.granted.v1", exhausted: "evt.credit.exhausted.v1" } as const;

/** The part of `@krizaka/outbox`'s `Outbox` this package needs: structural, so `credits` does not depend on `outbox`. */
export interface OutboxPort {
  append(tx: Query, message: { topic: string; type: string; payload: unknown; id?: string }): Promise<{ id: string; appended: boolean }>;
}

/** A stable UUID (version 5 shaped) from a seed: announcing the same fact twice is one outbox message. */
export function uuidOf(seed: string): string {
  const h = createHash("sha256").update(`krizaka.credits:${seed}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const base = { type: "object", additionalProperties: false } as const;

/** The JSON Schema of each event's payload (a consumer validates against it; the Java twin publishes the same names). */
export const CREDIT_EVENT_SCHEMAS = {
  [CREDIT_EVENT.granted]: {
    ...base,
    required: ["accountId", "grantId", "bucket", "amount", "source", "onExhausted"],
    properties: {
      accountId: { type: "string" },
      grantId: { type: "string" },
      bucket: { enum: ["granted", "purchased"] },
      amount: { type: "integer", minimum: 1 },
      expiresAt: { type: ["string", "null"], format: "date-time" },
      capPerDay: { type: ["integer", "null"], minimum: 1 },
      capPerMonth: { type: ["integer", "null"], minimum: 1 },
      onExhausted: { enum: ["stop", "fallback_paid"] },
      source: { type: "string" },
    },
  },
  [CREDIT_EVENT.exhausted]: {
    ...base,
    required: ["accountId", "grantId", "bucket", "source", "onExhausted"],
    properties: {
      accountId: { type: "string" },
      grantId: { type: "string" },
      bucket: { enum: ["granted", "purchased"] },
      onExhausted: { enum: ["stop", "fallback_paid"] },
      source: { type: "string" },
    },
  },
} as const;
