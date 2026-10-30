# @krizaka/notifications

## 0.2.2

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.
- Updated dependencies [2a7898c]
- Updated dependencies [2272b57]
  - @krizaka/time@0.2.0
  - @krizaka/settings@0.5.2

## 0.2.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.2.0

### Minor Changes

- 3609eec: New package (#60): `@krizaka/notifications`. `createNotifications` (`notify` writing the bell item and one outbox message per enabled channel: live, e-mail, push per device, as `evt.notification.requested.v1` in the shape of Java's request; `list`, `unreadCount`, `markRead`, `preferences`, `setPreference`, `setMatrix`, `registerDevice`, `revokeDevice`, `purge`, `erase`), per-category burst caps that hold under concurrency (advisory lock per account and category), locked categories, `dedupeKey`, `notificationsSchema` (`notifications.item`, `notifications.preference`, `notifications.device`), `dbNotificationStore`, `memoryNotificationStore`, `@krizaka/notifications/settings` (`notificationSettings(declared)`, `readNotificationConfig`) and `notificationStoreContract`.

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0
