import { randomUUID } from "node:crypto";

import { COUPONS_TOPIC, uuidOf } from "./events";
import { dbCouponStore } from "./persistence";
import {
  type Actor,
  type AuditPort,
  type Clock,
  type CouponSettings,
  type CouponStore,
  type CreditsPort,
  type OutboxPort,
  type Query,
  type RateLimitPort,
} from "./port";
import { checkSettings } from "./rules";

export interface CouponsDeps {
  clock: Clock;
  /** The settings, read at each call so the admin's change applies at once: an object, or a function over the settings service. */
  settings: CouponSettings | (() => CouponSettings | Promise<CouponSettings>);
  /** The trail (`createAudit(...)` of `@krizaka/audit`): every admin change and every redemption is recorded in the caller's transaction. */
  audit: AuditPort;
  /** The limiter (`createLimiter(...)` of `@krizaka/rate-limit`): each attempt with a code counts one hit on `COUPON_ATTEMPT_ACTION`. */
  rateLimit: RateLimitPort;
  /** The credits ledger (`createCredits(...)` of `@krizaka/credits`): needed for credit coupons. */
  credits?: CreditsPort;
  /** The outbox (`createOutbox(...)` of `@krizaka/outbox`): the events are appended in the caller's transaction. */
  outbox?: OutboxPort;
  /** The store over a query (a pool or a transaction). Default: the PostgreSQL store on schema `coupons`. */
  storeFor?: (query: Query) => CouponStore;
  /** The Postgres schema, when the product renamed the module's (used by the default store). */
  schema?: string;
  /** Fresh ids; default random UUIDs. */
  newId?: () => string;
}

/** The system as an actor (a webhook, a sweeper). */
export const SYSTEM: Actor = { id: null, label: "system" };

/** What the flows and the admin share: the clock, the settings, the store, the trail and the outbox. */
export interface Kernel {
  deps: CouponsDeps;
  now(): Date;
  settings(): Promise<CouponSettings>;
  store(query: Query): CouponStore;
  newId(): string;
  record(
    tx: Query,
    actor: Actor,
    action: string,
    target: { type: string; id: string },
    detail?: Record<string, unknown>,
  ): Promise<void>;
  announce(tx: Query, type: string, seed: string, payload: Record<string, unknown>): Promise<void>;
}

export function makeKernel(deps: CouponsDeps): Kernel {
  const storeFor = deps.storeFor ?? ((query: Query) => dbCouponStore(query, deps.schema ?? "coupons"));
  return {
    deps,
    now: () => deps.clock.now(),
    settings: async () => checkSettings(typeof deps.settings === "function" ? await deps.settings() : deps.settings),
    store: storeFor,
    newId: deps.newId ?? randomUUID,
    record: (tx, actor, action, target, detail = {}) =>
      deps.audit.record(tx, { actorId: actor.id, actorLabel: actor.label, action, target, detail }),
    async announce(tx, type, seed, payload) {
      await deps.outbox?.append(tx, { topic: COUPONS_TOPIC, type, payload, id: uuidOf(seed) });
    },
  };
}
