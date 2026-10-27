# @krizaka/notifications

The bell, the channels and the preferences for every Krizaka product. One `notify` writes the in-app item and appends one outbox message per enabled channel, respecting the account's matrix and a burst cap per category. No push or realtime import (the workers that deliver a channel are the product's), no database client, no wall clock.

- **Channels.** `app` (the bell and the live event of the open pages, one switch), `push` (one message per registered device) and `email`. The outbox topics are `notifications.live`, `notifications.push` and `notifications.email`; the event is `evt.notification.requested.v1`, the name and the shape of Java's `krizaka-notifications-api` request (`channel`, `recipient`, `template`, `locale`, `variables`, plus the ids; `channel` is `EMAIL`, and `PUSH` / `LIVE` for the web). A product delivers e-mail with its own worker (`@krizaka/email` to render, `@krizaka/mail` to queue) or lets the Java service consume it.
- **The product declares its categories** and their defaults (`notificationSettings(declared)` is the registry fragment); the admin tunes the default channels and the caps without a redeploy. A `locked` category (security, the account) cannot be switched off by anyone.
- **Burst caps.** After `burstMax` notifications of one category to one account within `burstWindowSeconds`, the next ones are bell-only: the item is kept, no channel is used. The count and the insert run under a transaction-level advisory lock per account and category, so the cap holds under concurrency when `notify` gets the caller's `tx`.
- **Idempotent.** `dedupeKey` makes one fact one notification; the outbox message ids derive from the item, so a retried append is a no-op.
- **The bell.** `list` (newest first, cursor), `unreadCount`, `markRead` (the account's own items; the first `read_at` stays). An item whose `app` channel was off is kept for the history and the cap, never shown.
- **Preferences.** `preferences` (every category by channel with its source: default, account, locked), `setPreference`, `setMatrix` (a preset applied).
- **Devices.** `registerDevice` (a token belongs to one account; registering it again moves it), `revokeDevice` when the push service refuses it.
- **Privacy.** The module holds no address (the product passes `email` per call); `erase(accountId)` removes the items, choices and devices; `purge` applies the retention.

```ts
import { createOutbox } from "@krizaka/outbox";
import { createNotifications, dbNotificationStore } from "@krizaka/notifications";
import { notificationSettings, readNotificationConfig } from "@krizaka/notifications/settings";

const declared = {
  messages: { defaults: { app: true, push: true, email: true }, burst: { max: 5, windowSeconds: 3600 } },
  follows: { defaults: { app: true, push: false, email: false } },
  account: { locked: true, defaults: { app: true, push: true, email: true } },
};
// settingsRegistry = { ...otherSettings, ...notificationSettings(declared) }

const notifications = createNotifications({
  clock,
  outbox: createOutbox({ clock, settings: outboxSettings }),
  config: () => readNotificationConfig(declared, (key) => settings.get(key)),
});

// in the use case's transaction
await notifications.notify(tx, { accountId, category: "messages", template: "new-message", variables: { name }, locale: "fr", email, dedupeKey: `message:${messageId}` });
```

Tables (schema `notifications`, `notificationsSchema`): `item`, `preference`, `device`. `notificationStoreContract` (`@krizaka/notifications/testkit`) is the contract every store runs.

Apache-2.0.
