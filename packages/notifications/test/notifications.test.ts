import { randomUUID } from "node:crypto";

import { createOutbox, memoryOutboxStore, OUTBOX_DEFAULTS } from "@krizaka/outbox";
import { describe, expect, it } from "vitest";

import { CHANNEL, checkInput, createNotifications, memoryNotificationStore, NOTIFICATION_CODE, type NotificationConfig, type NotificationRequest, resolveChannels } from "../src";
import { notificationSettings, readNotificationConfig } from "../src/settings";
import { notificationStoreContract, T0 } from "../src/testkit";

notificationStoreContract("memory", () => memoryNotificationStore(), () => randomUUID());

const on = { app: true, push: true, email: true };
const config = (over: Partial<NotificationConfig> = {}): NotificationConfig => ({
  retentionDays: 30,
  categories: {
    messages: { locked: false, defaults: on, burstMax: 3, burstWindowSeconds: 3600 },
    follows: { locked: false, defaults: { app: true, push: false, email: false }, burstMax: 50, burstWindowSeconds: 3600 },
    account: { locked: true, defaults: on, burstMax: 50, burstWindowSeconds: 3600 },
  },
  ...over,
});

function harness(cfg = config()) {
  let now = T0;
  const clock = { now: () => now };
  const outboxStore = memoryOutboxStore();
  const outbox = createOutbox({ clock, settings: OUTBOX_DEFAULTS, storeFor: () => outboxStore });
  const store = memoryNotificationStore();
  const notifications = createNotifications({ clock, outbox, config: cfg, storeFor: () => store });
  const tx = async () => [];
  const sent = async (topic?: string) => {
    const claimed = await outbox.claim(tx, { owner: "t", limit: 100, ...(topic ? { topic } : {}) });
    return claimed.map((m) => m.payload as NotificationRequest);
  };
  return { notifications, tx, sent, account: randomUUID(), advance: (s: number) => void (now = new Date(now.valueOf() + s * 1000)) };
}

describe("notify", () => {
  it.each(["ana", "@example.com", "ana@", "ana@example", "ana@@example.com", "ana@example..com", "ana@example.com.", "a na@example.com", "ana@example.com\r\nBcc: x@y.z", "<ana@example.com>"])("refuses the address « %s »", async (email) => {
    const h = harness();
    await expect(h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message", email })).rejects.toMatchObject({ code: NOTIFICATION_CODE.badInput });
  });
  it("answers in linear time to a long run of dots", async () => {
    const h = harness();
    const started = Date.now();
    await expect(h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message", email: `!@${"!.".repeat(50_000)}` })).rejects.toMatchObject({ code: NOTIFICATION_CODE.badInput });
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it("writes the bell item and one outbox message per enabled channel, in the shape of Java's request", async () => {
    const h = harness();
    await h.notifications.registerDevice(h.tx, h.account, { platform: "ios", token: "tok-a" });
    await h.notifications.registerDevice(h.tx, h.account, { platform: "android", token: "tok-b" });
    const result = await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message", variables: { name: "Ana" }, locale: "fr", email: "ana@example.com" });
    expect(result).toMatchObject({ duplicate: false, capped: false, channels: ["LIVE", "EMAIL", "PUSH"] });
    const requests = await h.sent();
    expect(requests.map((r) => [r.channel, r.recipient])).toEqual(expect.arrayContaining([["LIVE", h.account], ["EMAIL", "ana@example.com"], ["PUSH", "tok-a"], ["PUSH", "tok-b"]]));
    expect(requests).toHaveLength(4);
    expect(requests.find((r) => r.channel === "EMAIL")).toMatchObject({ template: "new-message", locale: "fr", variables: { name: "Ana" }, category: "messages", accountId: h.account });
    expect(await h.notifications.unreadCount(h.tx, h.account)).toBe(1);
    const [item] = await h.notifications.list(h.tx, h.account);
    expect(item).toMatchObject({ template: "new-message", payload: { variables: { name: "Ana" } } });
  });

  it("a disabled channel never sends: the category's default and the account's choice", async () => {
    const h = harness();
    await h.notifications.registerDevice(h.tx, h.account, { platform: "ios", token: "tok-a" });
    // follows: only the app by default
    await h.notifications.notify(h.tx, { accountId: h.account, category: "follows", template: "new-follower", email: "ana@example.com" });
    expect((await h.sent()).map((r) => r.channel)).toEqual(["LIVE"]);
    // the account turns the e-mail and the app of messages off
    await h.notifications.setPreference(h.tx, h.account, "messages", CHANNEL.email, false);
    await h.notifications.setPreference(h.tx, h.account, "messages", CHANNEL.app, false);
    const result = await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message", email: "ana@example.com" });
    expect(result.channels).toEqual(["PUSH"]);
    expect((await h.sent()).map((r) => r.channel)).toEqual(["PUSH"]);
    // the item is kept for the history but the bell does not show it
    expect(await h.notifications.unreadCount(h.tx, h.account)).toBe(1);
  });

  it("skips e-mail when no address is given, and push when the account has no device", async () => {
    const h = harness();
    expect((await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message" })).channels).toEqual(["LIVE"]);
  });

  it("a locked category follows its defaults whatever the account chose, and refuses to be switched off", async () => {
    const h = harness();
    await expect(h.notifications.setPreference(h.tx, h.account, "account", CHANNEL.email, false)).rejects.toMatchObject({ code: NOTIFICATION_CODE.locked });
    await h.notifications.setMatrix(h.tx, h.account, { account: { email: false }, follows: { push: true } });
    const view = await h.notifications.preferences(h.tx, h.account);
    expect(view.find((v) => v.category === "account")).toMatchObject({ locked: true, channels: { email: { enabled: true, source: "locked" } } });
    expect(view.find((v) => v.category === "follows")?.channels).toMatchObject({ push: { enabled: true, source: "account" }, email: { enabled: false, source: "default" } });
    await h.notifications.notify(h.tx, { accountId: h.account, category: "account", template: "storage-low", email: "ana@example.com" });
    expect((await h.sent()).some((r) => r.channel === "EMAIL")).toBe(true);
  });

  it("holds the burst cap: after the cap, the item is kept and no channel is used; the window moves on", async () => {
    const h = harness();
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message", email: "a@b.co" }));
    expect(results.map((r) => r.capped)).toEqual([false, false, false, true, true]);
    expect(results[4]!.channels).toEqual([]);
    expect((await h.sent()).length).toBe(6);
    expect(await h.notifications.unreadCount(h.tx, h.account)).toBe(5);
    h.advance(3601);
    expect((await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message" })).capped).toBe(false);
  });

  it("one dedupe key is one notification", async () => {
    const h = harness();
    const input = { accountId: h.account, category: "messages", template: "new-message", dedupeKey: "msg:42", email: "a@b.co" };
    expect((await h.notifications.notify(h.tx, input)).duplicate).toBe(false);
    expect(await h.notifications.notify(h.tx, input)).toEqual({ notificationId: null, duplicate: true, capped: false, channels: [] });
    expect(await h.sent()).toHaveLength(2);
  });

  it("reading marks read_at, once", async () => {
    const h = harness();
    await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message" });
    await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message" });
    const [first] = await h.notifications.list(h.tx, h.account);
    expect(await h.notifications.markRead(h.tx, h.account, [first!.id])).toBe(1);
    expect(await h.notifications.unreadCount(h.tx, h.account)).toBe(1);
    expect(await h.notifications.markRead(h.tx, h.account)).toBe(1);
    expect(await h.notifications.unreadCount(h.tx, h.account)).toBe(0);
  });

  it("purges past the retention, erases an account, and refuses a revoked device's token", async () => {
    const h = harness();
    await h.notifications.registerDevice(h.tx, h.account, { platform: "web", token: "tok-w" });
    await h.notifications.notify(h.tx, { accountId: h.account, category: "messages", template: "new-message" });
    expect(await h.notifications.revokeDevice(h.tx, "tok-w")).toBe(true);
    h.advance(31 * 86_400);
    expect(await h.notifications.purge(h.tx)).toBe(1);
    // the item is gone; the device (revoked, but held) and nothing else is erased
    expect(await h.notifications.erase(h.tx, h.account)).toBe(1);
    expect(await h.notifications.devices(h.tx, h.account)).toEqual([]);
  });
});

describe("the rules", () => {
  it("refuses an unknown category, a bad template, a non-string variable, a header-injected address and an oversized payload", async () => {
    const h = harness();
    await expect(h.notifications.notify(h.tx, { accountId: h.account, category: "nope", template: "x" })).rejects.toMatchObject({ code: NOTIFICATION_CODE.badCategory });
    const bad = (over: object) => () => checkInput({ accountId: h.account, category: "messages", template: "ok", ...over });
    expect(bad({ template: "Not Ok" })).toThrow(/template/);
    expect(bad({ variables: { n: 1 as unknown as string } })).toThrow(/string/);
    expect(bad({ email: "a@b.co\nBcc: x@y.co" })).toThrow(/address/);
    expect(bad({ payload: { blob: "x".repeat(9000) } })).toThrow(/too big/);
    expect(bad({ locale: "english" })).toThrow(/locale/);
  });
  it("refuses a config with a bad category name or a cap out of bounds", async () => {
    const bad = config({ categories: { "Bad-Name": config().categories.messages! } });
    const h = harness(bad);
    await expect(h.notifications.notify(h.tx, { accountId: h.account, category: "x", template: "x" })).rejects.toMatchObject({ code: NOTIFICATION_CODE.badConfig });
    const h2 = harness(config({ retentionDays: 0 }));
    await expect(h2.notifications.purge(h2.tx)).rejects.toMatchObject({ code: NOTIFICATION_CODE.badConfig });
  });
  it("resolves channels: defaults, then the account's choices, unless locked", () => {
    const def = config().categories;
    expect(resolveChannels(def.follows!, new Map([[CHANNEL.push, true]]))).toEqual({ app: true, push: true, email: false });
    expect(resolveChannels(def.account!, new Map([[CHANNEL.email, false]]))).toEqual(on);
  });
});

describe("the settings fragment", () => {
  const declared = { messages: { defaults: on, burst: { max: 5, windowSeconds: 600 } }, account: { locked: true, defaults: on } };
  it("declares a flag per category and channel, a burst cap per category, and nothing tunable for a locked category's channels", () => {
    const keys = Object.keys(notificationSettings(declared));
    expect(keys).toEqual(expect.arrayContaining(["notifications.retentionDays", "notifications.messages.app", "notifications.messages.push", "notifications.messages.email", "notifications.messages.burstMax", "notifications.account.burstMax"]));
    expect(keys).not.toContain("notifications.account.email");
    expect(() => notificationSettings({ "Bad-Name": { defaults: on } })).toThrow(/camel-case/);
  });
  it("reads the admin's values over what the product declared", async () => {
    const values: Record<string, boolean | number> = { "notifications.messages.email": false, "notifications.messages.burstMax": 9 };
    const cfg = await readNotificationConfig(declared, (key) => values[key]);
    expect(cfg.categories.messages).toEqual({ locked: false, defaults: { app: true, push: true, email: false }, burstMax: 9, burstWindowSeconds: 600 });
    expect(cfg.categories.account).toMatchObject({ locked: true, defaults: on, burstMax: 20 });
    expect(cfg.retentionDays).toBe(180);
  });
});
