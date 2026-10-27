import { subHours } from "@krizaka/time";

import { type Clock, DELIVERY_STATUS, type DeliveryEntry, MAIL_CODE, MailError, type MailMessage, type MailProvider, type MailSettings, type MailStore, type Query } from "./port";
import { bareAddress, checkMessage, hashAddress, uuidOf } from "./rules";
import type { Suppression } from "./webhooks";

/** The topic the mail is queued on, and the event that names it: the outbox routes by these. */
export const MAIL_TOPIC = "mail";
export const MAIL_EVENT = { requested: "evt.mail.requested.v1" } as const;

/** What the module needs of `@krizaka/outbox` (its `Outbox` satisfies it): append in the caller's transaction. */
export interface MailOutbox {
  append(tx: Query, message: { topic: string; type: string; payload: unknown; id: string }): Promise<{ id: string; appended: boolean }>;
}

/** The part of an outbox message the deliverer reads (`OutboxMessage` satisfies it). */
export interface QueuedMail {
  id: string;
  payload: unknown;
}

export interface MailDeps {
  clock: Clock;
  outbox: MailOutbox;
  /** The settings, read at each call so the admin's change applies at once. */
  settings: MailSettings | (() => MailSettings | Promise<MailSettings>);
  /** The state of the module over a query (a pool; a transaction is never needed). */
  store: MailStore;
  /** The provider the admin chose: a function so a change of `mail.provider` applies at once. */
  provider: MailProvider | ((settings: MailSettings) => MailProvider);
}

export interface Mail {
  /** Queues a mail INSIDE the caller's transaction: it is sent after the commit, and only if the transaction commits. `queued` is `false` when the same key was already queued. */
  queue(tx: Query, message: MailMessage): Promise<{ id: string; queued: boolean }>;
  /** Delivers one queued mail: skipped if its address is suppressed or its key was already sent, thrown (for a retry) if the provider fails. Give it to `runWorker` / `drainOnce` as `deliver`. */
  deliver(message: QueuedMail): Promise<DeliveryEntry["status"]>;
  /** A provider's webhook said this address bounced, complained or unsubscribed: it is never mailed again. */
  suppress(suppression: Suppression): Promise<boolean>;
  /** Lifts a suppression. */
  unsuppress(address: string): Promise<boolean>;
  isSuppressed(address: string): Promise<boolean>;
  /** Removes the log and the keys older than the retention. */
  purge(): Promise<number>;
}

const isMessage = (payload: unknown): payload is MailMessage => typeof payload === "object" && payload !== null && "to" in payload && "idempotencyKey" in payload;
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/**
 * The mail of a product.
 *
 * The guarantee is AT LEAST ONCE: a mail is sent, THEN its key is claimed, so a crash in between sends it again rather than never
 * (a duplicate reset mail beats a lost one). A second delivery after the claim is a no-op.
 * @param deps the clock, the outbox, the settings, the store and the provider
 * @returns the mail functions
 */
export function createMail(deps: MailDeps): Mail {
  const settings = async () => (typeof deps.settings === "function" ? await deps.settings() : deps.settings);
  const log = (entry: Omit<DeliveryEntry, "at">) => deps.store.record({ ...entry, at: deps.clock.now() });
  return {
    async queue(tx, message) {
      checkMessage(message);
      const id = uuidOf(message.idempotencyKey);
      const { appended } = await deps.outbox.append(tx, { topic: MAIL_TOPIC, type: MAIL_EVENT.requested, payload: message, id });
      return { id, queued: appended };
    },
    async deliver(queued) {
      if (!isMessage(queued.payload)) throw new MailError(MAIL_CODE.badMessage, `message ${queued.id} is not a mail`);
      const message = queued.payload;
      checkMessage(message);
      const hash = hashAddress(message.to);
      const base = { template: message.template, category: message.category, locale: message.locale, to: hash, idempotencyKey: message.idempotencyKey };
      if (await deps.store.isSuppressed(hash)) {
        await log({ ...base, status: DELIVERY_STATUS.suppressed });
        return DELIVERY_STATUS.suppressed;
      }
      if (await deps.store.hasKey(message.idempotencyKey)) {
        await log({ ...base, status: DELIVERY_STATUS.duplicate });
        return DELIVERY_STATUS.duplicate;
      }
      const s = await settings();
      const provider = typeof deps.provider === "function" ? deps.provider(s) : deps.provider;
      const replyTo = message.replyTo || s.replyTo;
      try {
        const sent = await provider.send({ ...message, from: s.from, ...(replyTo ? { replyTo } : {}) });
        await deps.store.claimKey(message.idempotencyKey, deps.clock.now());
        await log({ ...base, status: DELIVERY_STATUS.sent, messageId: sent.messageId ?? undefined, detail: provider.name });
        return DELIVERY_STATUS.sent;
      } catch (error) {
        await log({ ...base, status: DELIVERY_STATUS.failed, detail: reason(error) });
        throw error;
      }
    },
    suppress: (s) => deps.store.suppress(hashAddress(bareAddress(s.address)), s.reason, deps.clock.now()),
    unsuppress: (address) => deps.store.unsuppress(hashAddress(bareAddress(address))),
    isSuppressed: (address) => deps.store.isSuppressed(hashAddress(bareAddress(address))),
    async purge() {
      const s = await settings();
      return deps.store.purgeBefore(subHours(deps.clock.now(), s.retentionDays * 24));
    },
  };
}
