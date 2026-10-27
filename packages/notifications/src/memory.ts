import type { Channel, Device, Item, NotificationStore } from "./port";

const copy = <T extends object>(v: T): T => ({ ...v });
const newestFirst = (a: Item, b: Item) => b.createdAt.valueOf() - a.createdAt.valueOf() || b.id.localeCompare(a.id);

/** An in-memory store, for unit tests and demos: the behaviour of the database's (the contract kit runs on both). `record` is one synchronous step, so it is atomic. */
export function memoryNotificationStore(): NotificationStore {
  const items = new Map<string, Item>();
  const prefs = new Map<string, { category: string; channel: Channel; enabled: boolean }>();
  const devices = new Map<string, Device & { revokedAt: Date | null }>();
  return {
    async record(item, burst) {
      const mine = [...items.values()].filter((i) => i.accountId === item.accountId);
      if (item.dedupeKey !== null && mine.some((i) => i.dedupeKey === item.dedupeKey)) return { duplicate: true, capped: false };
      const recent = mine.filter((i) => i.category === item.category && i.createdAt >= burst.since).length;
      items.set(item.id, copy(item));
      return { duplicate: false, capped: recent >= burst.max };
    },
    async preferences(accountId) {
      return [...prefs.entries()].filter(([key]) => key.startsWith(`${accountId}|`)).map(([, row]) => copy(row));
    },
    async setPreference(accountId, category, channel, enabled) {
      prefs.set(`${accountId}|${category}|${channel}`, { category, channel, enabled });
    },
    async list(accountId, { unreadOnly, limit, before }) {
      return [...items.values()]
        .filter((i) => i.accountId === accountId && i.inBell && (!unreadOnly || i.readAt === null))
        .sort(newestFirst)
        .filter((i) => !before || i.createdAt < before.createdAt || (i.createdAt.valueOf() === before.createdAt.valueOf() && i.id < before.id))
        .slice(0, limit)
        .map(copy);
    },
    async unreadCount(accountId) {
      return [...items.values()].filter((i) => i.accountId === accountId && i.inBell && i.readAt === null).length;
    },
    async markRead(accountId, ids, now) {
      let n = 0;
      for (const item of items.values()) {
        if (item.accountId !== accountId || !item.inBell || item.readAt !== null || (ids !== null && !ids.includes(item.id))) continue;
        item.readAt = now;
        n += 1;
      }
      return n;
    },
    async upsertDevice(device) {
      const known = devices.get(device.token);
      devices.set(device.token, { ...device, id: known?.id ?? device.id, createdAt: known?.createdAt ?? device.createdAt, revokedAt: null });
    },
    async devices(accountId) {
      return [...devices.values()].filter((d) => d.accountId === accountId && d.revokedAt === null).map(({ revokedAt: _revoked, ...d }) => d);
    },
    async revokeDevice(token, now) {
      const d = devices.get(token);
      if (!d || d.revokedAt !== null) return false;
      d.revokedAt = now;
      return true;
    },
    async purgeBefore(before) {
      let n = 0;
      for (const [id, item] of items) {
        if (item.createdAt >= before) continue;
        items.delete(id);
        n += 1;
      }
      return n;
    },
    async erase(accountId) {
      let n = 0;
      for (const [id, item] of items) if (item.accountId === accountId && items.delete(id)) n += 1;
      for (const key of [...prefs.keys()]) if (key.startsWith(`${accountId}|`) && prefs.delete(key)) n += 1;
      for (const [token, d] of devices) if (d.accountId === accountId && devices.delete(token)) n += 1;
      return n;
    },
  };
}
