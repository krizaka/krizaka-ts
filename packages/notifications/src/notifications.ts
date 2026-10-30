import { randomUUID } from "node:crypto";

import { subHours, subSeconds } from "@krizaka/time";

import { dbNotificationStore } from "./persistence";
import {
  CHANNEL,
  type Channel,
  type Clock,
  DELIVERY,
  type Delivery,
  type Device,
  type Item,
  NOTIFICATION_CODE,
  type NotificationConfig,
  NotificationError,
  type NotificationStore,
  PLATFORM,
  type Platform,
  type Query,
} from "./port";
import {
  categoryOf,
  checkConfig,
  checkInput,
  type NotifyInput,
  type PreferenceView,
  resolveChannels,
  uuidOf,
  viewOf,
} from "./rules";

/** The event the outbox carries, the name Java's `krizaka-notifications-api` gives its request. */
export const NOTIFICATION_EVENT = { requested: "evt.notification.requested.v1" } as const;

/** One topic per delivery, so a worker claims only what it delivers (`notifications.email`, `notifications.push`, `notifications.live`). */
export const NOTIFICATION_TOPIC: Record<Delivery, string> = {
  [DELIVERY.email]: "notifications.email",
  [DELIVERY.push]: "notifications.push",
  [DELIVERY.live]: "notifications.live",
};

/** What the module needs of `@krizaka/outbox` (its `Outbox` satisfies it): append in the caller's transaction. */
export interface NotificationOutbox {
  append(
    tx: Query,
    message: { topic: string; type: string; payload: unknown; id: string },
  ): Promise<{ id: string; appended: boolean }>;
}

export interface NotificationDeps {
  clock: Clock;
  outbox: NotificationOutbox;
  /** The categories and the retention, read at each call so the admin's change applies at once. */
  config: NotificationConfig | (() => NotificationConfig | Promise<NotificationConfig>);
  /** The store over a query (a transaction or a pool). Default: the PostgreSQL store on schema `notifications`. */
  storeFor?: (query: Query) => NotificationStore;
  /** The Postgres schema, when the product renamed the module's (used by the default store). */
  schema?: string;
}

/** The request one delivery worker receives: Java's `NotificationRequest` (channel, recipient, template, locale, variables) plus the ids. */
export interface NotificationRequest {
  channel: Delivery;
  /** An e-mail address (EMAIL), a device token (PUSH) or an account id (LIVE). */
  recipient: string;
  template: string;
  locale: string | null;
  variables: Record<string, string>;
  notificationId: string;
  accountId: string;
  category: string;
  /** PUSH only. */
  platform?: Platform;
}

export interface Notified {
  /** `null` for a duplicate (same `dedupeKey`): nothing was written or appended. */
  notificationId: string | null;
  duplicate: boolean;
  /** Past the category's burst cap: the item is kept, the channels were not used. */
  capped: boolean;
  /** The channels that were used. */
  channels: Delivery[];
}

export interface Notifications {
  /**
   * Writes the bell item and appends one outbox message per enabled channel, in `tx` (use the caller's transaction: it is what makes
   * the burst cap hold under concurrency, and the messages leave only if the work commits).
   */
  notify(tx: Query, input: NotifyInput): Promise<Notified>;
  /** The bell, newest first. */
  list(
    query: Query,
    accountId: string,
    options?: { unreadOnly?: boolean; limit?: number; before?: { createdAt: Date; id: string } },
  ): Promise<Item[]>;
  unreadCount(query: Query, accountId: string): Promise<number>;
  /** Marks the account's own unread items read (those in `ids`, or all). Returns how many. */
  markRead(query: Query, accountId: string, ids?: readonly string[]): Promise<number>;
  /** The account's matrix: every category, every channel, and whether it is the default, the account's choice or locked. */
  preferences(query: Query, accountId: string): Promise<PreferenceView[]>;
  /** @throws NotificationError `NOTIFICATIONS_LOCKED` for a locked category, `NOTIFICATIONS_BAD_CATEGORY` for an unknown one. */
  setPreference(query: Query, accountId: string, category: string, channel: Channel, enabled: boolean): Promise<void>;
  /** The whole matrix at once (a preset applied): the locked categories are left as they are. */
  setMatrix(query: Query, accountId: string, matrix: Record<string, Partial<Record<Channel, boolean>>>): Promise<void>;
  registerDevice(query: Query, accountId: string, device: { platform: Platform; token: string }): Promise<void>;
  /** The push service refused the token: it is never used again until registered anew. */
  revokeDevice(query: Query, token: string): Promise<boolean>;
  devices(query: Query, accountId: string): Promise<Device[]>;
  /** Removes the items older than the retention. */
  purge(query: Query): Promise<number>;
  /** Erasure (Loi 25): everything held about the account. */
  erase(query: Query, accountId: string): Promise<number>;
}

const platforms = new Set<string>(Object.values(PLATFORM));

/**
 * The notifications of a product.
 * @param deps the clock, the outbox, the configuration, and optionally the store and schema
 * @returns the notification functions
 */
export function createNotifications(deps: NotificationDeps): Notifications {
  const storeFor = deps.storeFor ?? ((query: Query) => dbNotificationStore(query, deps.schema ?? "notifications"));
  const config = async () => checkConfig(typeof deps.config === "function" ? await deps.config() : deps.config);
  const asMap = (rows: { category: string; channel: Channel; enabled: boolean }[], category: string) =>
    new Map(rows.filter((r) => r.category === category).map((r) => [r.channel, r.enabled] as const));
  return {
    async notify(tx, input) {
      checkInput(input);
      const cfg = await config();
      const category = categoryOf(cfg, input.category);
      const now = deps.clock.now();
      const store = storeFor(tx);
      const channels = resolveChannels(category, asMap(await store.preferences(input.accountId), input.category));
      const item: Item = {
        id: randomUUID(),
        accountId: input.accountId,
        category: input.category,
        template: input.template,
        payload: { variables: input.variables ?? {}, ...(input.payload ?? {}) },
        dedupeKey: input.dedupeKey ?? null,
        inBell: channels.app,
        createdAt: now,
        readAt: null,
      };
      const { duplicate, capped } = await store.record(item, {
        max: category.burstMax,
        since: subSeconds(now, category.burstWindowSeconds),
      });
      if (duplicate) return { notificationId: null, duplicate: true, capped: false, channels: [] };
      const used: Delivery[] = [];
      if (!capped) {
        const base = {
          template: input.template,
          locale: input.locale ?? null,
          variables: input.variables ?? {},
          notificationId: item.id,
          accountId: input.accountId,
          category: input.category,
        };
        const send = async (request: NotificationRequest) => {
          await deps.outbox.append(tx, {
            topic: NOTIFICATION_TOPIC[request.channel],
            type: NOTIFICATION_EVENT.requested,
            payload: request,
            id: uuidOf(`${item.id}:${request.channel}:${request.recipient}`),
          });
          if (!used.includes(request.channel)) used.push(request.channel);
        };
        if (channels.app) await send({ ...base, channel: DELIVERY.live, recipient: input.accountId });
        if (channels.email && input.email) await send({ ...base, channel: DELIVERY.email, recipient: input.email });
        if (channels.push)
          for (const device of await store.devices(input.accountId))
            await send({ ...base, channel: DELIVERY.push, recipient: device.token, platform: device.platform });
      }
      return { notificationId: item.id, duplicate: false, capped, channels: used };
    },
    list: (query, accountId, options = {}) =>
      storeFor(query).list(accountId, {
        unreadOnly: options.unreadOnly ?? false,
        limit: options.limit ?? 30,
        ...(options.before ? { before: options.before } : {}),
      }),
    unreadCount: (query, accountId) => storeFor(query).unreadCount(accountId),
    markRead: (query, accountId, ids) => storeFor(query).markRead(accountId, ids ?? null, deps.clock.now()),
    async preferences(query, accountId) {
      return viewOf(await config(), await storeFor(query).preferences(accountId));
    },
    async setPreference(query, accountId, category, channel, enabled) {
      const def = categoryOf(await config(), category);
      if (def.locked)
        throw new NotificationError(NOTIFICATION_CODE.locked, `category « ${category} » cannot be switched off`);
      if (!Object.values(CHANNEL).includes(channel))
        throw new NotificationError(NOTIFICATION_CODE.badInput, `unknown channel « ${channel} »`);
      await storeFor(query).setPreference(accountId, category, channel, enabled, deps.clock.now());
    },
    async setMatrix(query, accountId, matrix) {
      const cfg = await config();
      for (const category of Object.keys(matrix)) categoryOf(cfg, category);
      const store = storeFor(query);
      for (const [category, row] of Object.entries(matrix)) {
        if (cfg.categories[category]!.locked) continue;
        for (const [channel, enabled] of Object.entries(row)) {
          if (!Object.values(CHANNEL).includes(channel as Channel))
            throw new NotificationError(NOTIFICATION_CODE.badInput, `unknown channel « ${channel} »`);
          if (typeof enabled === "boolean")
            await store.setPreference(accountId, category, channel as Channel, enabled, deps.clock.now());
        }
      }
    },
    async registerDevice(query, accountId, device) {
      if (!platforms.has(device.platform) || device.token.trim() === "" || device.token.length > 4096)
        throw new NotificationError(
          NOTIFICATION_CODE.badInput,
          "a device is a platform (ios, android, web) and a token",
        );
      const now = deps.clock.now();
      await storeFor(query).upsertDevice({
        id: randomUUID(),
        accountId,
        platform: device.platform,
        token: device.token,
        createdAt: now,
        lastSeenAt: now,
      });
    },
    revokeDevice: (query, token) => storeFor(query).revokeDevice(token, deps.clock.now()),
    devices: (query, accountId) => storeFor(query).devices(accountId),
    async purge(query) {
      const cfg = await config();
      return storeFor(query).purgeBefore(subHours(deps.clock.now(), cfg.retentionDays * 24));
    },
    erase: (query, accountId) => storeFor(query).erase(accountId),
  };
}
