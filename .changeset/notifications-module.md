---
"@krizaka/notifications": minor
---

New package (#60): `@krizaka/notifications`. `createNotifications` (`notify` writing the bell item and one outbox message per enabled channel: live, e-mail, push per device, as `evt.notification.requested.v1` in the shape of Java's request; `list`, `unreadCount`, `markRead`, `preferences`, `setPreference`, `setMatrix`, `registerDevice`, `revokeDevice`, `purge`, `erase`), per-category burst caps that hold under concurrency (advisory lock per account and category), locked categories, `dedupeKey`, `notificationsSchema` (`notifications.item`, `notifications.preference`, `notifications.device`), `dbNotificationStore`, `memoryNotificationStore`, `@krizaka/notifications/settings` (`notificationSettings(declared)`, `readNotificationConfig`) and `notificationStoreContract`.
