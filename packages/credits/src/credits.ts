import { randomUUID } from "node:crypto";

import { localDay } from "@krizaka/intl/date";
import { addSeconds } from "@krizaka/time";

import { CREDIT_EVENT, CREDITS_TOPIC, type OutboxPort, uuidOf } from "./events";
import { dbCreditStore } from "./persistence";
import {
  BUCKET,
  type Calendar,
  type Clock,
  CREDITS_CODE,
  CreditsError,
  type CreditsSettings,
  type CreditStore,
  type Entry,
  ENTRY_TYPE,
  type Grant,
  type GrantState,
  HOLD_STATUS,
  ON_EXHAUSTED,
  type OnExhausted,
  type Query,
} from "./port";
import { checkAmount, checkKey, checkNewGrant, checkSettings, type Draw, planDraws, skipFirst } from "./rules";

export interface CreditsDeps {
  clock: Clock;
  /** The settings, read at each call so the admin's change applies at once: an object, or a function over the settings service. */
  settings: CreditsSettings | (() => CreditsSettings | Promise<CreditsSettings>);
  /** The store over a query (a pool or a transaction). Default: the PostgreSQL store on schema `credits`. */
  storeFor?: (query: Query) => CreditStore;
  /** The Postgres schema, when the product renamed the module's (used by the default store). */
  schema?: string;
  /** Announces `evt.credit.granted.v1` and `evt.credit.exhausted.v1` in the caller's transaction (`createOutbox(...)` of `@krizaka/outbox`). */
  outbox?: OutboxPort;
  /** Fresh ids; default random UUIDs. */
  newId?: () => string;
}

export interface GrantInput {
  accountId: string;
  /** Credits, a positive integer. */
  amount: number;
  /** When the pot lapses. Required, in the future. */
  expiresAt: Date;
  capPerDay?: number | null;
  capPerMonth?: number | null;
  onExhausted: OnExhausted;
  /** `coupon:<redemptionId>`, `plan:monthly`… */
  source: string;
  /** One key per grant: a replay answers the same grant and writes nothing. */
  idempotencyKey: string;
}

export interface PurchaseInput {
  accountId: string;
  amount: number;
  /** `purchase:<paymentRef>`. */
  source: string;
  idempotencyKey: string;
}

export interface ConsumeInput {
  accountId: string;
  amount: number;
  /** What it was spent on (`audit:<id>`): kept on the line. */
  reason: string;
  idempotencyKey: string;
}

export interface Consumed {
  draws: Draw[];
  /** True when the key was seen before: the first answer is repeated and nothing was written. */
  replayed: boolean;
}

export interface Balance {
  /** What can be spent now (not lapsed, not closed), holds not subtracted. */
  total: number;
  granted: number;
  purchased: number;
  /** Kept back by active holds. */
  held: number;
  /** `total - held`, never negative. */
  available: number;
  grants: {
    id: string;
    bucket: Grant["bucket"];
    remaining: number;
    expiresAt: Date | null;
    source: string;
    capPerDay: number | null;
    capPerMonth: number | null;
    onExhausted: OnExhausted;
  }[];
}

/** The ledger as a product uses it. Every function takes the `Query` it works through: pass `tx` to join a unit of work. */
export interface Credits {
  /** Free usage that lapses, with optional caps. Idempotent by key. */
  grant(tx: Query, input: GrantInput): Promise<{ grantId: string; replayed: boolean }>;
  /** Paid usage: it does not lapse and has no cap. Idempotent by key. */
  purchase(tx: Query, input: PurchaseInput): Promise<{ grantId: string; replayed: boolean }>;
  /** Spends credits from the pots that lapse first, within their caps; refuses with `CREDITS_CAP_DAY`, `CREDITS_CAP_MONTH`, `CREDITS_EXHAUSTED` or `PAYWALL`. Nothing is partial. */
  consume(tx: Query, input: ConsumeInput): Promise<Consumed>;
  /** Keeps credits back for work that has not finished; the reserve counts against caps and balance. */
  hold(
    tx: Query,
    input: { accountId: string; amount: number; ttlSeconds?: number; idempotencyKey: string },
  ): Promise<{ holdId: string; expiresAt: Date; replayed: boolean }>;
  /** Spends what the work cost (at most the hold's amount; default all of it) and frees the rest. Once. */
  settle(tx: Query, holdId: string, options?: { amount?: number; reason?: string }): Promise<Consumed>;
  /** Frees a hold without spending. Idempotent. */
  release(tx: Query, holdId: string): Promise<void>;
  /** Gives back what an earlier consume or settle spent, to the same pots, once. */
  refund(
    tx: Query,
    input: { accountId: string; consumed?: string; settledHold?: string; reason: string },
  ): Promise<{ refunded: number; replayed: boolean }>;
  /** Closes a pot: what is left is written off by an EXPIRY line. Credits already spent are never taken back. Idempotent. */
  expire(tx: Query, grantId: string): Promise<{ expired: number }>;
  /** Closes the granted pots past their date that still hold credits (a job's sweep). */
  expireDue(tx: Query, options?: { limit?: number }): Promise<number>;
  /** A signed correction by an administrator, never taking a pot below zero. */
  adjust(
    tx: Query,
    input: { accountId: string; grantId: string; amount: number; reason: string; idempotencyKey: string },
  ): Promise<{ replayed: boolean }>;
  balance(query: Query, accountId: string): Promise<Balance>;
  history(query: Query, accountId: string, options?: { limit?: number; before?: Date }): Promise<Entry[]>;
}

const MAX_REASON = 300;
// @fixed: the page size of the history when the caller names none (a screen's worth)
const DEFAULT_HISTORY = 50;
// @fixed: the most lines the history returns in one call
const MAX_HISTORY = 500;
// @fixed: the sweep's default batch
const DEFAULT_SWEEP = 100;

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * The credits ledger of a product.
 * @param deps the clock, the settings, and optionally the store, the schema, the outbox and the id source
 * @returns the ledger's functions
 */
export function createCredits(deps: CreditsDeps): Credits {
  const schema = deps.schema ?? "credits";
  const storeFor = deps.storeFor ?? ((query: Query) => dbCreditStore(query, schema));
  const settings = async () =>
    checkSettings(typeof deps.settings === "function" ? await deps.settings() : deps.settings);
  const newId = deps.newId ?? randomUUID;

  const calendarOf = (now: Date, timeZone: string): Calendar => {
    const day = localDay(now, timeZone);
    return { timeZone, day, month: day.slice(0, 7) };
  };
  const statesOf = async (store: CreditStore, accountId: string, now: Date, timeZone: string): Promise<GrantState[]> =>
    store.grantStates(accountId, calendarOf(now, timeZone));

  const entry = (
    over: Pick<Entry, "accountId" | "grantId" | "type" | "amount" | "reason" | "operation"> &
      Partial<Pick<Entry, "reverses" | "holdId">>,
    n: number,
    at: Date,
  ): Entry => ({
    id: newId(),
    reverses: null,
    holdId: null,
    ...over,
    idempotencyKey: `${over.operation}:${n}`,
    at,
  });

  /** A replay finds the lines of its operation. A key already used by another account is a bug of the caller, refused. */
  const replayOf = async (store: CreditStore, operation: string, accountId: string): Promise<Entry[]> => {
    const lines = await store.entriesOf(operation);
    if (lines.some((l) => l.accountId !== accountId))
      throw new CreditsError(CREDITS_CODE.keyReused, "This idempotency key was used for another account");
    return lines;
  };

  const announce = async (tx: Query, type: string, seed: string, payload: Record<string, unknown>) => {
    await deps.outbox?.append(tx, { topic: CREDITS_TOPIC, type, payload, id: uuidOf(seed) });
  };
  const grantPayload = (g: Grant) => ({
    accountId: g.accountId,
    grantId: g.id,
    bucket: g.bucket,
    amount: g.amount,
    expiresAt: g.expiresAt?.toISOString() ?? null,
    capPerDay: g.capPerDay,
    capPerMonth: g.capPerMonth,
    onExhausted: g.onExhausted,
    source: g.source,
  });
  const announceExhausted = (tx: Query, states: readonly GrantState[], draws: readonly Draw[]) =>
    Promise.all(
      draws.flatMap((d) => {
        const s = states.find((x) => x.grant.id === d.grantId);
        if (!s || s.remaining - d.amount > 0) return [];
        const g = s.grant;
        return [
          announce(tx, CREDIT_EVENT.exhausted, `exhausted:${g.id}`, {
            accountId: g.accountId,
            grantId: g.id,
            bucket: g.bucket,
            onExhausted: g.onExhausted,
            source: g.source,
          }),
        ];
      }),
    );

  async function create(
    tx: Query,
    kind: "grant" | "purchase",
    input: GrantInput | PurchaseInput,
  ): Promise<{ grantId: string; replayed: boolean }> {
    const now = deps.clock.now();
    checkNewGrant(kind, input, now);
    const granted = kind === "grant";
    const g = input as GrantInput;
    const store = storeFor(tx);
    await store.lock(input.accountId);
    const operation = `${kind}.${input.idempotencyKey}`;
    const before = await replayOf(store, operation, input.accountId);
    if (before[0]?.grantId) return { grantId: before[0].grantId, replayed: true };
    const grant: Grant = {
      id: newId(),
      accountId: input.accountId,
      bucket: granted ? BUCKET.granted : BUCKET.purchased,
      amount: input.amount,
      capPerDay: granted ? (g.capPerDay ?? null) : null,
      capPerMonth: granted ? (g.capPerMonth ?? null) : null,
      expiresAt: granted ? g.expiresAt : null,
      onExhausted: granted ? g.onExhausted : ON_EXHAUSTED.fallbackPaid,
      source: input.source,
      createdAt: now,
    };
    await store.insertGrant(grant);
    await store.insertEntries([
      entry(
        {
          accountId: grant.accountId,
          grantId: grant.id,
          type: granted ? ENTRY_TYPE.grant : ENTRY_TYPE.purchase,
          amount: input.amount,
          reason: input.source,
          operation,
        },
        0,
        now,
      ),
    ]);
    await announce(tx, CREDIT_EVENT.granted, `granted:${grant.id}`, grantPayload(grant));
    return { grantId: grant.id, replayed: false };
  }

  const drawsOf = (lines: readonly Entry[]): Draw[] =>
    lines
      .filter((l) => l.type === ENTRY_TYPE.debit && l.grantId)
      .map((l) => ({ grantId: l.grantId!, amount: -l.amount }));

  /** Plans and writes the debits of one operation. The caller holds the account's lock and has checked the replay. */
  async function spend(
    tx: Query,
    store: CreditStore,
    args: {
      accountId: string;
      amount: number;
      reason: string;
      operation: string;
      holdId?: string;
      exceptHoldId?: string;
    },
  ): Promise<Draw[]> {
    const { timeZone } = await settings();
    const now = deps.clock.now();
    const held = await store.heldAmount(args.accountId, now, args.exceptHoldId);
    const states = await statesOf(store, args.accountId, now, timeZone);
    const plan = planDraws(states, held + args.amount, now);
    if (!plan.ok) throw new CreditsError(plan.code, REFUSAL_TEXT[plan.code] ?? plan.code);
    const draws = skipFirst(plan.draws, held);
    await store.insertEntries(
      draws.map((d, i) =>
        entry(
          {
            accountId: args.accountId,
            grantId: d.grantId,
            type: ENTRY_TYPE.debit,
            amount: -d.amount,
            reason: args.reason,
            operation: args.operation,
            ...(args.holdId ? { holdId: args.holdId } : {}),
          },
          i,
          now,
        ),
      ),
    );
    await announceExhausted(tx, states, draws);
    return draws;
  }

  async function expire(tx: Query, grantId: string): Promise<{ expired: number }> {
    const store = storeFor(tx);
    const found = await store.grantById(grantId);
    if (!found) throw new CreditsError(CREDITS_CODE.unknownGrant, `No grant ${grantId}`);
    await store.lock(found.accountId);
    const { timeZone } = await settings();
    const now = deps.clock.now();
    const state = (await statesOf(store, found.accountId, now, timeZone)).find((s) => s.grant.id === grantId)!;
    if (state.closed) return { expired: 0 };
    await store.insertEntries([
      entry(
        {
          accountId: found.accountId,
          grantId,
          type: ENTRY_TYPE.expiry,
          amount: -state.remaining,
          reason: "expiry",
          operation: `expire.${grantId}`,
        },
        0,
        now,
      ),
    ]);
    return { expired: state.remaining };
  }

  return {
    grant: (tx, input) => create(tx, "grant", input),
    purchase: (tx, input) => create(tx, "purchase", input),

    async consume(tx, input) {
      checkAmount(input.amount, "a consumption");
      checkKey(input.idempotencyKey);
      if (!input.reason || input.reason.length > MAX_REASON)
        throw new CreditsError(CREDITS_CODE.badGrant, `A reason is 1 to ${MAX_REASON} characters`);
      const store = storeFor(tx);
      await store.lock(input.accountId);
      const operation = `consume.${input.idempotencyKey}`;
      const before = await replayOf(store, operation, input.accountId);
      if (before.length > 0) return { draws: drawsOf(before), replayed: true };
      return {
        draws: await spend(tx, store, {
          accountId: input.accountId,
          amount: input.amount,
          reason: input.reason,
          operation,
        }),
        replayed: false,
      };
    },

    async hold(tx, input) {
      checkAmount(input.amount, "a hold");
      checkKey(input.idempotencyKey);
      const s = await settings();
      const ttl = input.ttlSeconds ?? s.holdTtlSeconds;
      checkSettings({ ...s, holdTtlSeconds: ttl });
      const store = storeFor(tx);
      await store.lock(input.accountId);
      const operation = `hold.${input.idempotencyKey}`;
      const known = await store.holdByOperation(operation);
      if (known) {
        if (known.accountId !== input.accountId)
          throw new CreditsError(CREDITS_CODE.keyReused, "This idempotency key was used for another account");
        return { holdId: known.id, expiresAt: known.expiresAt, replayed: true };
      }
      const now = deps.clock.now();
      const held = await store.heldAmount(input.accountId, now);
      const plan = planDraws(await statesOf(store, input.accountId, now, s.timeZone), held + input.amount, now);
      if (!plan.ok) throw new CreditsError(plan.code, REFUSAL_TEXT[plan.code] ?? plan.code);
      const hold = {
        id: newId(),
        accountId: input.accountId,
        amount: input.amount,
        expiresAt: addSeconds(now, ttl),
        status: HOLD_STATUS.active,
        settledAmount: null,
        createdAt: now,
        closedAt: null,
        operation,
      };
      await store.insertHold(hold);
      return { holdId: hold.id, expiresAt: hold.expiresAt, replayed: false };
    },

    async settle(tx, holdId, options = {}) {
      const store = storeFor(tx);
      const found = await store.holdById(holdId);
      if (!found) throw new CreditsError(CREDITS_CODE.unknownHold, `No hold ${holdId}`);
      await store.lock(found.accountId);
      const hold = (await store.holdById(holdId))!;
      const operation = `settle.${holdId}`;
      if (hold.status === HOLD_STATUS.settled)
        return { draws: drawsOf(await store.entriesOf(operation)), replayed: true };
      if (hold.status === HOLD_STATUS.released)
        throw new CreditsError(CREDITS_CODE.holdClosed, "This hold was released");
      const amount = options.amount ?? hold.amount;
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > hold.amount)
        throw new CreditsError(
          CREDITS_CODE.badAmount,
          `A hold of ${hold.amount} settles for 0 to ${hold.amount}, got ${amount}`,
        );
      const now = deps.clock.now();
      const draws =
        amount === 0
          ? []
          : await spend(tx, store, {
              accountId: hold.accountId,
              amount,
              reason: options.reason ?? `hold:${holdId}`,
              operation,
              holdId,
              exceptHoldId: holdId,
            });
      await store.closeHold(holdId, amount === 0 ? HOLD_STATUS.released : HOLD_STATUS.settled, amount, now);
      return { draws, replayed: false };
    },

    async release(tx, holdId) {
      const store = storeFor(tx);
      const found = await store.holdById(holdId);
      if (!found) throw new CreditsError(CREDITS_CODE.unknownHold, `No hold ${holdId}`);
      await store.lock(found.accountId);
      const hold = (await store.holdById(holdId))!;
      if (hold.status === HOLD_STATUS.released) return;
      if (hold.status === HOLD_STATUS.settled) throw new CreditsError(CREDITS_CODE.holdClosed, "This hold was settled");
      await store.closeHold(holdId, HOLD_STATUS.released, null, deps.clock.now());
    },

    async refund(tx, input) {
      const original =
        input.consumed !== undefined
          ? `consume.${checkKey(input.consumed)}`
          : input.settledHold !== undefined
            ? `settle.${input.settledHold}`
            : null;
      if (!original)
        throw new CreditsError(CREDITS_CODE.badKey, "Name what to refund: a consumed key or a settled hold");
      if (!input.reason || input.reason.length > MAX_REASON)
        throw new CreditsError(CREDITS_CODE.badGrant, `A reason is 1 to ${MAX_REASON} characters`);
      const store = storeFor(tx);
      await store.lock(input.accountId);
      const operation = `refund.${original}`;
      const done = await replayOf(store, operation, input.accountId);
      if (done.length > 0) return { refunded: sum(done.map((l) => l.amount)), replayed: true };
      const spent = (await replayOf(store, original, input.accountId)).filter((l) => l.type === ENTRY_TYPE.debit);
      if (spent.length === 0)
        throw new CreditsError(CREDITS_CODE.nothingToRefund, "Nothing was spent under this key for this account");
      const now = deps.clock.now();
      await store.insertEntries(
        spent.map((l, i) =>
          entry(
            {
              accountId: l.accountId,
              grantId: l.grantId,
              type: ENTRY_TYPE.refund,
              amount: -l.amount,
              reason: input.reason,
              operation,
              reverses: original,
            },
            i,
            now,
          ),
        ),
      );
      return { refunded: sum(spent.map((l) => -l.amount)), replayed: false };
    },

    expire,

    async expireDue(tx, options = {}) {
      const store = storeFor(tx);
      const due = await store.lapsedWithCredits(deps.clock.now(), options.limit ?? DEFAULT_SWEEP);
      let n = 0;
      for (const d of due) n += (await expire(tx, d.grantId)).expired > 0 ? 1 : 0;
      return n;
    },

    async adjust(tx, input) {
      checkKey(input.idempotencyKey);
      if (!Number.isSafeInteger(input.amount) || input.amount === 0)
        throw new CreditsError(CREDITS_CODE.badAmount, "An adjustment is a non-zero integer");
      if (!input.reason || input.reason.length > MAX_REASON)
        throw new CreditsError(CREDITS_CODE.badGrant, `A reason is 1 to ${MAX_REASON} characters`);
      const store = storeFor(tx);
      await store.lock(input.accountId);
      const operation = `adjust.${input.idempotencyKey}`;
      if ((await replayOf(store, operation, input.accountId)).length > 0) return { replayed: true };
      const { timeZone } = await settings();
      const now = deps.clock.now();
      const state = (await statesOf(store, input.accountId, now, timeZone)).find((s) => s.grant.id === input.grantId);
      if (!state) throw new CreditsError(CREDITS_CODE.unknownGrant, `No grant ${input.grantId} for this account`);
      if (state.remaining + input.amount < 0)
        throw new CreditsError(CREDITS_CODE.badAmount, "An adjustment never takes a pot below zero");
      await store.insertEntries([
        entry(
          {
            accountId: input.accountId,
            grantId: input.grantId,
            type: ENTRY_TYPE.adjustment,
            amount: input.amount,
            reason: input.reason,
            operation,
          },
          0,
          now,
        ),
      ]);
      return { replayed: false };
    },

    async balance(query, accountId) {
      const store = storeFor(query);
      const { timeZone } = await settings();
      const now = deps.clock.now();
      const live = (await statesOf(store, accountId, now, timeZone)).filter(
        (s) => !s.closed && (s.grant.expiresAt === null || s.grant.expiresAt > now) && s.remaining > 0,
      );
      const of = (bucket: Grant["bucket"]) =>
        sum(live.filter((s) => s.grant.bucket === bucket).map((s) => s.remaining));
      const total = of(BUCKET.granted) + of(BUCKET.purchased);
      const held = await store.heldAmount(accountId, now);
      return {
        total,
        granted: of(BUCKET.granted),
        purchased: of(BUCKET.purchased),
        held,
        available: Math.max(0, total - held),
        grants: live.map((s) => ({
          id: s.grant.id,
          bucket: s.grant.bucket,
          remaining: s.remaining,
          expiresAt: s.grant.expiresAt,
          source: s.grant.source,
          capPerDay: s.grant.capPerDay,
          capPerMonth: s.grant.capPerMonth,
          onExhausted: s.grant.onExhausted,
        })),
      };
    },

    history: (query, accountId, options = {}) =>
      storeFor(query).history(accountId, {
        limit: Math.min(options.limit ?? DEFAULT_HISTORY, MAX_HISTORY),
        ...(options.before ? { before: options.before } : {}),
      }),
  };
}

const REFUSAL_TEXT: Record<string, string> = {
  [CREDITS_CODE.capDay]: "The daily limit of free credits is reached",
  [CREDITS_CODE.capMonth]: "The monthly limit of free credits is reached",
  [CREDITS_CODE.exhausted]: "The free credits have run out",
  [CREDITS_CODE.paywall]: "Payment required: no credits left",
};
