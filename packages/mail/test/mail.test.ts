import { createHmac } from "node:crypto";

import { createOutbox, drainOnce, memoryOutboxStore, OUTBOX_DEFAULTS } from "@krizaka/outbox";
import { describe, expect, it } from "vitest";

import { checkMessage, createMail, emailPorts, type FetchLike, hashAddress, logProvider, MAIL_CODE, MAIL_DEFAULTS, mailgunProvider, type MailMessage, type MailProvider, memoryMailStore, type OutgoingMail, parseMailgunWebhook, parseResendWebhook, providerFor, resendProvider } from "../src";
import { mailStoreContract, T0 } from "../src/testkit";

mailStoreContract("memory", () => memoryMailStore());

const message = (over: Partial<MailMessage> = {}): MailMessage => ({ to: "ana@example.com", subject: "Reset your password", text: "Open the link.", category: "transactional", template: "password-reset", locale: "en", idempotencyKey: "reset:1", ...over });
const tx = async () => [];

/** A mail module on the memory outbox and store, a provider that records, and a clock the test moves. */
function harness(provider?: Partial<MailProvider>) {
  let now = T0;
  const clock = { now: () => now };
  const store = memoryMailStore();
  const outboxStore = memoryOutboxStore();
  const outbox = createOutbox({ clock, settings: OUTBOX_DEFAULTS, storeFor: () => outboxStore });
  const sent: OutgoingMail[] = [];
  const real: MailProvider = { name: "fake", send: provider?.send ?? (async (m) => (sent.push(m), { messageId: `<${sent.length}>` })) };
  const mail = createMail({ clock, outbox, settings: { ...MAIL_DEFAULTS, from: "Krizaka <no-reply@krizaka.com>", replyTo: "help@krizaka.com" }, store, provider: real });
  const drain = () => drainOnce({ outbox, query: tx, owner: "w1", topic: "mail", deliver: (m) => mail.deliver(m).then(() => undefined) });
  return { mail, store, sent, drain, advance: (s: number) => void (now = new Date(now.valueOf() + s * 1000)) };
}

describe("the queue and the worker", () => {
  it("delivers a queued mail with the sender and reply-to of the settings, and logs it without the address", async () => {
    const h = harness();
    expect(await h.mail.queue(tx, message())).toMatchObject({ queued: true });
    expect(await h.drain()).toMatchObject({ claimed: 1, delivered: 1 });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ to: "ana@example.com", from: "Krizaka <no-reply@krizaka.com>", replyTo: "help@krizaka.com" });
    const [line] = await h.store.recent(5);
    expect(line).toMatchObject({ status: "sent", messageId: "<1>", to: hashAddress("ana@example.com"), detail: "fake" });
    expect(JSON.stringify(line)).not.toContain("ana@example.com");
  });

  it("closes the gap of a mail written to a table nobody flushes: a queued mail is delivered by the first drain", async () => {
    const h = harness();
    await h.mail.queue(tx, message({ idempotencyKey: "welcome:akinaza:1", template: "welcome" }));
    expect((await h.drain()).delivered).toBe(1);
    expect((await h.drain()).claimed).toBe(0);
  });

  it("one idempotency key queues once and sends once", async () => {
    const h = harness();
    expect((await h.mail.queue(tx, message())).queued).toBe(true);
    expect((await h.mail.queue(tx, message())).queued).toBe(false);
    await h.drain();
    expect(h.sent).toHaveLength(1);
    // a redelivery of the same message (the lease lapsed after the send) finds the claimed key
    expect(await h.mail.deliver({ id: "x", payload: message() })).toBe("duplicate");
    expect(h.sent).toHaveLength(1);
  });

  it("never sends to a suppressed address, whatever the case or the name around it", async () => {
    const h = harness();
    await h.mail.suppress({ address: "Ana <ANA@example.com>", reason: "bounce" });
    expect(await h.mail.isSuppressed("ana@example.com")).toBe(true);
    await h.mail.queue(tx, message());
    await h.drain();
    expect(h.sent).toEqual([]);
    expect((await h.store.recent(1))[0]).toMatchObject({ status: "suppressed" });
    expect(await h.mail.unsuppress("ana@example.com")).toBe(true);
  });

  it("retries a provider failure, then sends, and the key is claimed only after the send", async () => {
    let fail = true;
    const sent: string[] = [];
    const h = harness({
      send: async (m) => {
        if (fail) throw new Error("mailgun answered 500");
        sent.push(m.to);
        return { messageId: null };
      },
    });
    await h.mail.queue(tx, message());
    expect(await h.drain()).toMatchObject({ retried: 1, delivered: 0 });
    expect(await h.store.hasKey("reset:1")).toBe(false);
    expect((await h.store.recent(1))[0]).toMatchObject({ status: "failed", detail: expect.stringContaining("500") });
    fail = false;
    h.advance(3600);
    expect(await h.drain()).toMatchObject({ delivered: 1 });
    expect(sent).toEqual(["ana@example.com"]);
    expect(await h.store.hasKey("reset:1")).toBe(true);
  });

  it("purges the log and the keys past the retention", async () => {
    const h = harness();
    await h.mail.queue(tx, message());
    await h.drain();
    h.advance(91 * 24 * 3600);
    expect(await h.mail.purge()).toBe(2);
  });

  it("refuses a payload that is not a mail", async () => {
    const h = harness();
    await expect(h.mail.deliver({ id: "x", payload: { hello: 1 } })).rejects.toMatchObject({ code: MAIL_CODE.badMessage });
  });
});

describe("the rules", () => {
  it.each([
    ["a header injection in the subject", { subject: "hi\r\nBcc: x@y.co" }],
    ["a bad address", { to: "not an address" }],
    ["an injected address", { to: "a@b.co\nBcc: x@y.co" }],
    ["an empty key", { idempotencyKey: "" }],
    ["an upper-case category", { category: "Transactional" }],
    ["a bad locale", { locale: "english" }],
  ])("refuses %s", (_what, over) => {
    expect(() => checkMessage(message(over))).toThrow(expect.objectContaining({ code: expect.stringMatching(/^MAIL_BAD_/) }));
  });
  it("hashes an address by its normal form", () => {
    expect(hashAddress(" A@B.co ")).toBe(hashAddress("a@b.co"));
    expect(hashAddress("a@b.co")).toHaveLength(64);
  });
});

const out: OutgoingMail = { ...message(), from: "Krizaka <no-reply@krizaka.com>", html: "<p>Hi</p>", replyTo: "help@krizaka.com" };
const capture = (status = 200, body = '{"id":"<m1>"}') => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: FetchLike = async (url, init) => (calls.push({ url, headers: init.headers, body: init.body }), { ok: status < 300, status, text: async () => body });
  return { calls, fetch };
};

describe("the providers", () => {
  it("mailgun posts a form to the domain's messages endpoint with basic auth", async () => {
    const c = capture();
    expect(await mailgunProvider({ apiKey: "key-1", domain: "mg.krizaka.com", fetch: c.fetch }).send(out)).toEqual({ messageId: "<m1>" });
    const call = c.calls[0]!;
    expect(call.url).toBe("https://api.mailgun.net/v3/mg.krizaka.com/messages");
    expect(call.headers.authorization).toBe(`Basic ${Buffer.from("api:key-1").toString("base64")}`);
    const form = new URLSearchParams(call.body);
    expect(Object.fromEntries(form)).toMatchObject({ from: out.from, to: out.to, subject: out.subject, text: out.text, html: "<p>Hi</p>", "h:Reply-To": "help@krizaka.com" });
  });
  it("mailgun uses the EU endpoint when told", async () => {
    const c = capture();
    await mailgunProvider({ apiKey: "k", domain: "d.eu", apiUrl: "https://api.eu.mailgun.net/", fetch: c.fetch }).send(out);
    expect(c.calls[0]!.url).toBe("https://api.eu.mailgun.net/v3/d.eu/messages");
  });
  it("resend posts JSON with a bearer key and the idempotency key", async () => {
    const c = capture(200, '{"id":"re_1"}');
    expect(await resendProvider({ apiKey: "re_key", fetch: c.fetch }).send(out)).toEqual({ messageId: "re_1" });
    const call = c.calls[0]!;
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.headers).toMatchObject({ authorization: "Bearer re_key", "idempotency-key": "reset:1" });
    expect(JSON.parse(call.body)).toMatchObject({ from: out.from, to: [out.to], reply_to: "help@krizaka.com", html: "<p>Hi</p>" });
  });
  it.each([["mailgun"], ["resend"]] as const)("%s throws on a non-2xx answer, so the outbox retries", async (kind) => {
    const c = capture(500, "boom");
    const p = kind === "mailgun" ? mailgunProvider({ apiKey: "k", domain: "d", fetch: c.fetch }) : resendProvider({ apiKey: "k", fetch: c.fetch });
    await expect(p.send(out)).rejects.toMatchObject({ code: MAIL_CODE.provider });
  });
  it("log writes one line without the body", async () => {
    const lines: string[] = [];
    await logProvider((l) => lines.push(l)).send(out);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("Open the link");
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "mail.log", from: "no-reply@krizaka.com" });
  });
  it("providerFor refuses a chosen provider without its key instead of falling back to log", () => {
    const c = capture();
    const nowhere = () => undefined;
    expect(() => providerFor("mailgun", {}, c.fetch, nowhere)).toThrow(/API key/);
    expect(() => providerFor("mailgun", { apiKey: "k" }, c.fetch, nowhere)).toThrow(/domain/);
    expect(providerFor("resend", { apiKey: "k" }, c.fetch, nowhere).name).toBe("resend");
    expect(providerFor("log", {}, c.fetch, nowhere).name).toBe("log");
  });
});

describe("the webhooks", () => {
  const key = "signing-key";
  const now = 1792000000;
  const mailgun = (event: Record<string, unknown>, over: { signature?: string } = {}) => {
    const timestamp = String(now);
    const token = "tok123";
    const signature = over.signature ?? createHmac("sha256", key).update(timestamp + token).digest("hex");
    return JSON.stringify({ signature: { timestamp, token, signature }, "event-data": event });
  };
  it("mailgun: a permanent failure, a complaint and an unsubscribe suppress; a temporary failure and a delivery do not", () => {
    expect(parseMailgunWebhook(mailgun({ event: "failed", severity: "permanent", recipient: "a@b.co" }), key, now)).toEqual({ address: "a@b.co", reason: "bounce" });
    expect(parseMailgunWebhook(mailgun({ event: "complained", recipient: "a@b.co" }), key, now)).toEqual({ address: "a@b.co", reason: "complaint" });
    expect(parseMailgunWebhook(mailgun({ event: "unsubscribed", recipient: "a@b.co" }), key, now)).toEqual({ address: "a@b.co", reason: "unsubscribed" });
    expect(parseMailgunWebhook(mailgun({ event: "failed", severity: "temporary", recipient: "a@b.co" }), key, now)).toBeNull();
    expect(parseMailgunWebhook(mailgun({ event: "delivered", recipient: "a@b.co" }), key, now)).toBeNull();
  });
  it("mailgun: refuses a wrong signature, a stale timestamp, another key and a body that is not JSON", () => {
    const complaint = { event: "complained", recipient: "a@b.co" };
    expect(() => parseMailgunWebhook(mailgun(complaint, { signature: "00" }), key, now)).toThrow(/signature/);
    expect(() => parseMailgunWebhook(mailgun(complaint), key, now + 3600)).toThrow(/stale/);
    expect(() => parseMailgunWebhook("nope", key, now)).toThrow(/JSON/);
    expect(() => parseMailgunWebhook(mailgun(complaint), "another-key", now)).toThrow(/signature/);
  });

  const bytes = Buffer.from("resend-key-bytes");
  const webhookKey = `whsec_${bytes.toString("base64")}`;
  const svix = (event: unknown) => {
    const body = JSON.stringify(event);
    const mac = createHmac("sha256", bytes).update(`msg_1.${now}.${body}`).digest("base64");
    return { body, headers: { id: "msg_1", timestamp: String(now), signature: `v1,${mac}` } };
  };
  it("resend: a hard bounce and a complaint suppress every recipient; a transient bounce does not", () => {
    const hard = svix({ type: "email.bounced", data: { to: ["a@b.co", "c@d.co"], bounce: { type: "Permanent" } } });
    expect(parseResendWebhook(hard.body, hard.headers, webhookKey, now)).toEqual([
      { address: "a@b.co", reason: "bounce" },
      { address: "c@d.co", reason: "bounce" },
    ]);
    const spam = svix({ type: "email.complained", data: { to: ["a@b.co"] } });
    expect(parseResendWebhook(spam.body, spam.headers, webhookKey, now)).toEqual([{ address: "a@b.co", reason: "complaint" }]);
    const soft = svix({ type: "email.bounced", data: { to: ["a@b.co"], bounce: { type: "Transient" } } });
    expect(parseResendWebhook(soft.body, soft.headers, webhookKey, now)).toEqual([]);
    const ok = svix({ type: "email.delivered", data: { to: ["a@b.co"] } });
    expect(parseResendWebhook(ok.body, ok.headers, webhookKey, now)).toEqual([]);
  });
  it("resend: accepts a rotated key's second signature, refuses a bad one, missing headers and a stale timestamp", () => {
    const e = svix({ type: "email.complained", data: { to: ["a@b.co"] } });
    expect(parseResendWebhook(e.body, { ...e.headers, signature: `v1,AAAA ${e.headers.signature}` }, webhookKey, now)).toHaveLength(1);
    expect(() => parseResendWebhook(e.body, { ...e.headers, signature: "v1,AAAA" }, webhookKey, now)).toThrow(/signature/);
    expect(() => parseResendWebhook(e.body, { id: null, timestamp: null, signature: null }, webhookKey, now)).toThrow(/missing/);
    expect(() => parseResendWebhook(e.body, e.headers, webhookKey, now + 3600)).toThrow(/stale/);
  });
});

describe("the ports of @krizaka/email", () => {
  it("writes the same tables as the queue: log, suppression, idempotency", async () => {
    const store = memoryMailStore();
    const ports = emailPorts(store, { now: () => T0 });
    await ports.suppression.add("Ana@Example.com", "complaint");
    expect(await ports.suppression.has("ana@example.com")).toBe(true);
    expect(await ports.idempotency.claim("k")).toBe(true);
    expect(await ports.idempotency.claim("k")).toBe(false);
    await ports.idempotency.release("k");
    expect(await ports.idempotency.claim("k")).toBe(true);
    await ports.log.record({ template: "t", category: "transactional", locale: "en", to: hashAddress("ana@example.com"), status: "sent" });
    expect((await store.recent(1))[0]).toMatchObject({ status: "sent", at: T0.toISOString() });
  });
});
