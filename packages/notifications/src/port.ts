/**
 * The ports of « notifications »: the bell (an item per notification), the account's preferences (a matrix of categories by
 * channels), the phones registered for push, and one outbox message per enabled channel. Generic: no push or realtime import (the
 * workers that deliver a channel are the product's, or the Java service's for e-mail), no database client, no wall clock.
 */
export type { Clock, Query } from "@krizaka/db";

/**
 * The channels an account switches. `app` is the bell and the live event of the open pages (one switch, like Orochia's matrix);
 * `push` goes to the account's registered phones; `email` to its address.
 */
export const CHANNEL = { app: "app", push: "push", email: "email" } as const;
export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL];
export const CHANNELS: readonly Channel[] = [CHANNEL.app, CHANNEL.push, CHANNEL.email];

/** What the outbox carries: the `channel` of Java's `evt.notification.requested.v1` (EMAIL) and two more for the web (PUSH, LIVE). */
export const DELIVERY = { email: "EMAIL", push: "PUSH", live: "LIVE" } as const;
export type Delivery = (typeof DELIVERY)[keyof typeof DELIVERY];

export const PLATFORM = { ios: "ios", android: "android", web: "web" } as const;
export type Platform = (typeof PLATFORM)[keyof typeof PLATFORM];

/** A category as the product declares it. */
export interface CategoryDefaults {
  /** Cannot be switched off (security, the account): its channels follow `defaults`, whatever the account chose. */
  locked: boolean;
  /** Which channels are on until the account chooses. */
  defaults: Record<Channel, boolean>;
  /** After `burstMax` notifications of this category to one account within `burstWindowSeconds`, the next ones are bell-only. */
  burstMax: number;
  burstWindowSeconds: number;
}

/** The categories (declared by the product, tuned by the admin) and the retention. Read from the settings at each call. */
export interface NotificationConfig {
  categories: Record<string, CategoryDefaults>;
  /** Days an item is kept before `purge`. */
  retentionDays: number;
}

/** One line of the bell. */
export interface Item {
  id: string;
  accountId: string;
  category: string;
  template: string;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  /** Shown in the bell. An item whose app channel was off is kept (the burst count and the history) but not shown. */
  inBell: boolean;
  createdAt: Date;
  readAt: Date | null;
}

export interface Device {
  id: string;
  accountId: string;
  platform: Platform;
  token: string;
  createdAt: Date;
  lastSeenAt: Date;
}

/** Where the state lives. Every adapter runs `notificationStoreContract` (`@krizaka/notifications/testkit`). */
export interface NotificationStore {
  /**
   * Writes the item and says whether it exceeds the burst cap, ATOMICALLY per account and category (the database serialises
   * concurrent callers with a transaction-level advisory lock, so the cap holds under concurrency: pass the caller's `tx`).
   * `duplicate` when the account already has an item with this `dedupeKey`: nothing is written.
   */
  record(item: Item, burst: { max: number; since: Date }): Promise<{ duplicate: boolean; capped: boolean }>;
  /** The account's explicit choices. */
  preferences(accountId: string): Promise<{ category: string; channel: Channel; enabled: boolean }[]>;
  setPreference(accountId: string, category: string, channel: Channel, enabled: boolean, now: Date): Promise<void>;
  /** Items shown in the bell, newest first; `before` is the cursor (the last item of the previous page). */
  list(accountId: string, options: { unreadOnly: boolean; limit: number; before?: { createdAt: Date; id: string } }): Promise<Item[]>;
  unreadCount(accountId: string): Promise<number>;
  /** Marks read the account's own unread items among `ids` (all of them when `ids` is null). The first `read_at` stays. Returns how many. */
  markRead(accountId: string, ids: readonly string[] | null, now: Date): Promise<number>;
  /** A token belongs to one account: registering it again moves it, and brings back a revoked one. */
  upsertDevice(device: Device): Promise<void>;
  devices(accountId: string): Promise<Device[]>;
  /** The push service said the token is dead. */
  revokeDevice(token: string, now: Date): Promise<boolean>;
  purgeBefore(before: Date): Promise<number>;
  /** Removes everything held about the account. Returns how many rows. */
  erase(accountId: string): Promise<number>;
}

export const NOTIFICATION_CODE = {
  badCategory: "NOTIFICATIONS_BAD_CATEGORY",
  badInput: "NOTIFICATIONS_BAD_INPUT",
  locked: "NOTIFICATIONS_LOCKED",
  badConfig: "NOTIFICATIONS_BAD_CONFIG",
} as const;
export type NotificationCode = (typeof NOTIFICATION_CODE)[keyof typeof NOTIFICATION_CODE];

export class NotificationError extends Error {
  constructor(
    readonly code: NotificationCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}
