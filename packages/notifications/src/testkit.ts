import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { CHANNEL, type Item, type NotificationStore } from "./port";

export const T0 = new Date("2026-10-26T12:00:00.000Z");
export const at = (seconds: number) => new Date(T0.valueOf() + seconds * 1000);

/** An item for tests; the account ids are UUIDs because the database's are. */
export const itemOf = (accountId: string, over: Partial<Item> = {}): Item => ({ id: randomUUID(), accountId, category: "messages", template: "new-message", payload: { variables: {} }, dedupeKey: null, inBell: true, createdAt: T0, readAt: null, ...over });
const BURST = { max: 3, since: at(-3600) };

/** What every `NotificationStore` adapter must do: the same behaviour behind the same port. `make` gives an empty store whose accounts exist. */
export function notificationStoreContract(name: string, make: () => NotificationStore | Promise<NotificationStore>, accountId: () => string | Promise<string>) {
  it(`${name}: records an item, and says it is capped once the window already holds the cap`, async () => {
    const store = await make();
    const a = await accountId();
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await store.record(itemOf(a, { createdAt: at(i) }), BURST));
    expect(results.map((r) => r.capped)).toEqual([false, false, false, true, true]);
    expect(results.every((r) => !r.duplicate)).toBe(true);
    // another category and another window are counted apart
    expect((await store.record(itemOf(a, { category: "follows" }), BURST)).capped).toBe(false);
    expect((await store.record(itemOf(a), { max: 3, since: at(100) })).capped).toBe(false);
  });

  it(`${name}: writes nothing for a second item with the same dedupe key, and lets another account use it`, async () => {
    const store = await make();
    const a = await accountId();
    const b = await accountId();
    expect(await store.record(itemOf(a, { dedupeKey: "bid:1" }), BURST)).toEqual({ duplicate: false, capped: false });
    expect(await store.record(itemOf(a, { dedupeKey: "bid:1" }), BURST)).toEqual({ duplicate: true, capped: false });
    expect(await store.record(itemOf(b, { dedupeKey: "bid:1" }), BURST)).toEqual({ duplicate: false, capped: false });
    expect(await store.list(a, { unreadOnly: false, limit: 10 })).toHaveLength(1);
  });

  it(`${name}: lists the bell newest first with a cursor, hides what was not shown, and counts the unread`, async () => {
    const store = await make();
    const a = await accountId();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const item = itemOf(a, { createdAt: at(i) });
      ids.push(item.id);
      await store.record(item, { max: 100, since: at(-3600) });
    }
    await store.record(itemOf(a, { createdAt: at(9), inBell: false }), { max: 100, since: at(-3600) });
    const first = await store.list(a, { unreadOnly: false, limit: 2 });
    expect(first.map((i) => i.id)).toEqual([ids[4], ids[3]]);
    const next = await store.list(a, { unreadOnly: false, limit: 10, before: { createdAt: first[1]!.createdAt, id: first[1]!.id } });
    expect(next.map((i) => i.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(await store.unreadCount(a)).toBe(5);
  });

  it(`${name}: marks read only the account's own unread items, keeps the first read_at`, async () => {
    const store = await make();
    const a = await accountId();
    const b = await accountId();
    const mine = itemOf(a);
    const theirs = itemOf(b);
    const other = itemOf(a, { createdAt: at(1) });
    for (const i of [mine, theirs, other]) await store.record(i, BURST);
    expect(await store.markRead(a, [mine.id, theirs.id], at(10))).toBe(1);
    expect(await store.markRead(a, [mine.id], at(20))).toBe(0);
    expect((await store.list(a, { unreadOnly: false, limit: 10 })).find((i) => i.id === mine.id)?.readAt?.toISOString()).toBe(at(10).toISOString());
    expect(await store.unreadCount(b)).toBe(1);
    expect((await store.list(a, { unreadOnly: true, limit: 10 })).map((i) => i.id)).toEqual([other.id]);
    expect(await store.markRead(a, null, at(30))).toBe(1);
    expect(await store.unreadCount(a)).toBe(0);
  });

  it(`${name}: keeps an account's choices, one per category and channel, the last one winning`, async () => {
    const store = await make();
    const a = await accountId();
    await store.setPreference(a, "messages", CHANNEL.email, false, T0);
    await store.setPreference(a, "messages", CHANNEL.push, true, T0);
    await store.setPreference(a, "messages", CHANNEL.email, true, at(5));
    const rows = (await store.preferences(a)).sort((x, y) => x.channel.localeCompare(y.channel));
    expect(rows).toEqual([
      { category: "messages", channel: "email", enabled: true },
      { category: "messages", channel: "push", enabled: true },
    ]);
    expect(await store.preferences(await accountId())).toEqual([]);
  });

  it(`${name}: registers a device once per token, moves it to a new account, revokes it and brings it back`, async () => {
    const store = await make();
    const a = await accountId();
    const b = await accountId();
    const device = (account: string, token: string, seconds: number) => ({ id: randomUUID(), accountId: account, platform: "ios" as const, token, createdAt: at(seconds), lastSeenAt: at(seconds) });
    await store.upsertDevice(device(a, "tok-1", 0));
    await store.upsertDevice(device(a, "tok-1", 5));
    await store.upsertDevice(device(a, "tok-2", 6));
    expect((await store.devices(a)).map((d) => d.token)).toEqual(["tok-1", "tok-2"]);
    expect((await store.devices(a))[0]!.createdAt.toISOString()).toBe(at(0).toISOString());
    expect(await store.revokeDevice("tok-1", at(10))).toBe(true);
    expect(await store.revokeDevice("tok-1", at(11))).toBe(false);
    expect((await store.devices(a)).map((d) => d.token)).toEqual(["tok-2"]);
    await store.upsertDevice(device(b, "tok-1", 20));
    expect((await store.devices(b)).map((d) => d.token)).toEqual(["tok-1"]);
    expect((await store.devices(a)).map((d) => d.token)).toEqual(["tok-2"]);
  });

  it(`${name}: purges old items and erases everything about an account`, async () => {
    const store = await make();
    const a = await accountId();
    const b = await accountId();
    await store.record(itemOf(a, { createdAt: at(-86_400 * 10) }), { max: 100, since: at(-86_400 * 20) });
    await store.record(itemOf(a), { max: 100, since: at(-3600) });
    expect(await store.purgeBefore(at(-86_400))).toBe(1);
    await store.record(itemOf(b), BURST);
    await store.setPreference(a, "messages", CHANNEL.app, false, T0);
    await store.upsertDevice({ id: randomUUID(), accountId: a, platform: "web", token: "tok-erase", createdAt: T0, lastSeenAt: T0 });
    expect(await store.erase(a)).toBe(3);
    expect(await store.unreadCount(a)).toBe(0);
    expect(await store.preferences(a)).toEqual([]);
    expect(await store.devices(a)).toEqual([]);
    expect(await store.unreadCount(b)).toBe(1);
  });
}
