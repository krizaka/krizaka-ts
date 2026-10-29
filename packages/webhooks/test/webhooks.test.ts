import crypto from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createWebhooks,
  endpointUrlProblem,
  EVENT_ID_HEADER,
  type OutgoingRequest,
  type Query,
  receiveWebhook,
  SIGNATURE_HEADER,
  signBody,
  verifySignature,
  webhooksMigration,
} from "../src";

const T = 1_790_000_000;

describe("the signature", () => {
  const body = '{"id":"e1","type":"booking.created"}';
  it("signs the timestamp with the body and verifies it", () => {
    const header = signBody("whsec_x", body, T);
    expect(header).toMatch(/^t=1790000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature("whsec_x", body, header, T + 10)).toEqual({ ok: true });
  });
  it("refuses a wrong secret, a changed body, a missing or malformed header", () => {
    const header = signBody("whsec_x", body, T);
    expect(verifySignature("whsec_y", body, header, T)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature("whsec_x", `${body} `, header, T)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature("whsec_x", body, null, T)).toEqual({ ok: false, reason: "missing" });
    expect(verifySignature("whsec_x", body, "garbage", T)).toEqual({ ok: false, reason: "malformed" });
  });
  it("refuses a replay older than the tolerance (and one from the future)", () => {
    const header = signBody("whsec_x", body, T);
    expect(verifySignature("whsec_x", body, header, T + 301)).toEqual({ ok: false, reason: "stale" });
    expect(verifySignature("whsec_x", body, header, T - 301)).toEqual({ ok: false, reason: "stale" });
  });
  it("accepts any of several v1 values (a secret being rotated)", () => {
    const old = signBody("whsec_old", body, T).split(",v1=")[1];
    const next = signBody("whsec_new", body, T);
    expect(verifySignature("whsec_old", body, `${next},v1=${old}`, T)).toEqual({ ok: true });
  });
});

describe("where a webhook may go", () => {
  it.each(["https://example.com/hook", "https://hooks.example.co.uk:8443/a?b=1"])("%s is allowed", (u) =>
    expect(endpointUrlProblem(u)).toBeNull(),
  );
  it.each([
    ["not a url", "NOT_A_URL"],
    ["http://example.com/x", "NOT_HTTPS"],
    ["https://user:pw@example.com/", "CREDENTIALS"],
    ["https://localhost/x", "NOT_PUBLIC"],
    ["https://intranet/x", "NOT_PUBLIC"],
    ["https://127.0.0.1/x", "NOT_PUBLIC"],
    ["https://10.1.2.3/x", "NOT_PUBLIC"],
    ["https://169.254.169.254/latest", "NOT_PUBLIC"],
    ["https://192.168.0.5/x", "NOT_PUBLIC"],
    ["https://172.20.0.1/x", "NOT_PUBLIC"],
    ["https://[::1]/x", "NOT_PUBLIC"],
    ["https://db.internal/x", "NOT_PUBLIC"],
  ])("%s is refused (%s)", (u, why) => expect(endpointUrlProblem(u)).toBe(why));
});

/** The adapter against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date(T * 1000);
const RULES = { events: ["booking.created", "invoice.paid"], maxAttempts: 3, backoffSeconds: [30, 300] };

describe.runIf(enabled)("webhooks on PostgreSQL", () => {
  const schemaName = `wh_${Math.random().toString(36).slice(2, 10)}`;
  let client: pg.Client;
  let query: Query;
  const hooks = () =>
    createWebhooks({
      query: (s, p) => query(s, p),
      rules: RULES,
      secrets: { seal: (s) => `sealed:${s}`, open: (s) => s.replace(/^sealed:/, "") },
    });
  const owner = async () =>
    (
      await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [
        `o-${Math.random().toString(36).slice(2)}@test.example`,
      ])
    )[0]!.id;
  /** The queue is shared by the tests of this file: empty it, so a test sees only its own deliveries. */
  const drain = () => hooks().deliverDue(NOW, async () => ({ status: 200 }), { limit: 1000 });
  const URL_ = "https://hooks.example.com/akinaza";

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schemaName}; SET search_path TO ${schemaName}`);
    let queue: Promise<unknown> = Promise.resolve(); // one client: statements run one after another
    query = (sql, params) => {
      const run = queue.then(async () => (await client.query(sql, params as unknown[])).rows);
      queue = run.catch(() => undefined);
      return run as never;
    };
    await client.query(
      "CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL)",
    );
    await client.query(webhooksMigration());
    await client.query(webhooksMigration()); // twice: safe
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await client.end();
  });

  it("registers an endpoint (the secret once, kept sealed), refuses bad addresses and events, enforces the quota", async () => {
    const o = await owner();
    const { endpoint, secret } = await hooks().registerEndpoint(
      o,
      { url: URL_, events: ["booking.created"] },
      { maxEndpoints: 2 },
      NOW,
    );
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify(await hooks().listEndpoints(o))).not.toContain(secret);
    expect(
      (
        await query<{ secret_sealed: string }>("SELECT secret_sealed FROM webhook_endpoints WHERE id = $1", [
          endpoint.id,
        ])
      )[0]!.secret_sealed,
    ).toBe(`sealed:${secret}`);
    await expect(
      hooks().registerEndpoint(o, { url: "http://x.com", events: ["booking.created"] }, { maxEndpoints: 2 }, NOW),
    ).rejects.toMatchObject({ code: "WEBHOOK_URL" });
    await expect(
      hooks().registerEndpoint(o, { url: URL_, events: ["nope"] }, { maxEndpoints: 2 }, NOW),
    ).rejects.toMatchObject({ code: "WEBHOOK_EVENTS" });
    await hooks().registerEndpoint(o, { url: `${URL_}/2`, events: ["invoice.paid"] }, { maxEndpoints: 2 }, NOW);
    await expect(
      hooks().registerEndpoint(o, { url: `${URL_}/3`, events: ["invoice.paid"] }, { maxEndpoints: 2 }, NOW),
    ).rejects.toMatchObject({ code: "WEBHOOK_LIMIT" });
  });

  it("queues an event once per subscribed endpoint, however often it is emitted; another owner's endpoints are never fed", async () => {
    const [a, b] = [await owner(), await owner()];
    await hooks().registerEndpoint(a, { url: URL_, events: ["booking.created"] }, { maxEndpoints: 5 }, NOW);
    await hooks().registerEndpoint(a, { url: `${URL_}/inv`, events: ["invoice.paid"] }, { maxEndpoints: 5 }, NOW);
    await hooks().registerEndpoint(b, { url: URL_, events: ["booking.created"] }, { maxEndpoints: 5 }, NOW);
    expect(await hooks().emit(a, { id: "booking:1", type: "booking.created", payload: { id: "1" } }, NOW)).toBe(1);
    expect(await hooks().emit(a, { id: "booking:1", type: "booking.created", payload: { id: "1" } }, NOW)).toBe(0);
    await expect(hooks().emit(a, { id: "x", type: "nope", payload: {} }, NOW)).rejects.toMatchObject({
      code: "WEBHOOK_EVENTS",
    });
    expect(
      await query(
        "SELECT 1 FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE e.owner_id = $1",
        [b],
      ),
    ).toHaveLength(0);
  });

  it("delivers signed (the receiver can verify it), logs it, and does not send it twice", async () => {
    await drain();
    const o = await owner();
    const { endpoint, secret } = await hooks().registerEndpoint(
      o,
      { url: URL_, events: ["invoice.paid"] },
      { maxEndpoints: 5 },
      NOW,
    );
    await hooks().emit(o, { id: "invoice:9", type: "invoice.paid", payload: { number: "F-00009" } }, NOW);
    const sent: OutgoingRequest[] = [];
    const ok = async (r: OutgoingRequest) => (sent.push(r), { status: 204 });
    expect(await hooks().deliverDue(NOW, ok)).toMatchObject({ delivered: 1 });
    const r = sent.at(-1)!;
    expect(r.url).toBe(URL_);
    expect(verifySignature(secret, r.body, r.headers[SIGNATURE_HEADER], T)).toEqual({ ok: true });
    expect(r.headers[EVENT_ID_HEADER]).toBe("invoice:9");
    expect(JSON.parse(r.body)).toMatchObject({ id: "invoice:9", type: "invoice.paid", data: { number: "F-00009" } });
    const before = sent.length;
    await hooks().deliverDue(NOW, ok);
    expect(sent.length).toBe(before);
    expect((await hooks().deliveries(o, endpoint.id))[0]).toMatchObject({
      status: "delivered",
      attempts: 1,
      lastStatus: 204,
    });
  });

  it("retries with the backoff, then gives up and says why; a deactivated endpoint is left alone", async () => {
    await drain();
    const o = await owner();
    const { endpoint } = await hooks().registerEndpoint(
      o,
      { url: URL_, events: ["booking.created"] },
      { maxEndpoints: 5 },
      NOW,
    );
    await hooks().emit(o, { id: "booking:7", type: "booking.created", payload: {} }, NOW);
    const down = async () => ({ status: 500 });
    expect(await hooks().deliverDue(NOW, down)).toMatchObject({ retried: 1 });
    expect(await hooks().deliverDue(NOW, down)).toEqual({ delivered: 0, retried: 0, failed: 0 }); // not due yet
    const t2 = new Date(NOW.getTime() + 31_000);
    expect(
      await hooks().deliverDue(t2, async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    ).toMatchObject({ retried: 1 });
    const t3 = new Date(NOW.getTime() + 31_000 + 301_000);
    expect(await hooks().deliverDue(t3, down)).toMatchObject({ failed: 1 });
    expect((await hooks().deliveries(o, endpoint.id))[0]).toMatchObject({
      status: "failed",
      attempts: 3,
      lastStatus: 500,
    });
    await hooks().emit(o, { id: "booking:8", type: "booking.created", payload: {} }, NOW);
    await hooks().updateEndpoint(o, endpoint.id, { active: false });
    expect(await hooks().deliverDue(t3, async () => ({ status: 200 }))).toEqual({
      delivered: 0,
      retried: 0,
      failed: 0,
    });
  });

  it("rotating the secret changes the signature at once; only the owner can touch an endpoint", async () => {
    await drain();
    const [o, other] = [await owner(), await owner()];
    const { endpoint, secret } = await hooks().registerEndpoint(
      o,
      { url: URL_, events: ["booking.created"] },
      { maxEndpoints: 5 },
      NOW,
    );
    const { secret: next } = await hooks().rotateSecret(o, endpoint.id);
    expect(next).not.toBe(secret);
    await hooks().emit(o, { id: "booking:rot", type: "booking.created", payload: {} }, NOW);
    let req: OutgoingRequest | undefined;
    await hooks().deliverDue(NOW, async (r) => ((req = r), { status: 200 }));
    expect(verifySignature(next, req!.body, req!.headers[SIGNATURE_HEADER], T).ok).toBe(true);
    expect(verifySignature(secret, req!.body, req!.headers[SIGNATURE_HEADER], T).ok).toBe(false);
    await expect(hooks().removeEndpoint(other, endpoint.id)).rejects.toMatchObject({ code: "WEBHOOK_NOT_FOUND" });
    await expect(hooks().deliveries(other, endpoint.id)).rejects.toMatchObject({ code: "WEBHOOK_NOT_FOUND" });
    await hooks().removeEndpoint(o, endpoint.id);
    expect(await hooks().listEndpoints(o)).toEqual([]);
  });

  describe("an incoming webhook", () => {
    const secret = "whsec_in";
    const body = '{"id":"evt_1"}';
    const input = (over: object = {}) => ({
      source: "processor",
      secret,
      rawBody: body,
      signature: signBody(secret, body, T),
      eventId: `evt_${Math.random().toString(36).slice(2)}`,
      now: NOW,
      ...over,
    });

    it("is verified, then applied exactly once; a replay changes nothing", async () => {
      let applied = 0;
      const i = input();
      expect(await receiveWebhook({ query: (s, p) => query(s, p) }, i, async () => void applied++)).toBe("applied");
      expect(await receiveWebhook({ query: (s, p) => query(s, p) }, i, async () => void applied++)).toBe("duplicate");
      expect(applied).toBe(1);
    });
    it("refuses a bad or stale signature before recording anything", async () => {
      const i = input({ signature: signBody("whsec_other", body, T) });
      await expect(receiveWebhook({ query: (s, p) => query(s, p) }, i, async () => undefined)).rejects.toMatchObject({
        code: "WEBHOOK_SIGNATURE",
      });
      await expect(
        receiveWebhook(
          { query: (s, p) => query(s, p) },
          input({ now: new Date((T + 1000) * 1000) }),
          async () => undefined,
        ),
      ).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE" });
      expect(await query("SELECT 1 FROM webhook_received WHERE event_id = $1", [i.eventId])).toHaveLength(0);
    });
    it("when applying fails the event is not kept as received, so the sender's retry applies it", async () => {
      const i = input();
      await expect(
        receiveWebhook({ query: (s, p) => query(s, p) }, i, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      let applied = 0;
      expect(await receiveWebhook({ query: (s, p) => query(s, p) }, i, async () => void applied++)).toBe("applied");
      expect(applied).toBe(1);
    });
    it("the same id from another source is another event", async () => {
      const id = `evt_${crypto.randomUUID()}`;
      expect(
        await receiveWebhook(
          { query: (s, p) => query(s, p) },
          input({ eventId: id, source: "a" }),
          async () => undefined,
        ),
      ).toBe("applied");
      expect(
        await receiveWebhook(
          { query: (s, p) => query(s, p) },
          input({ eventId: id, source: "b" }),
          async () => undefined,
        ),
      ).toBe("applied");
    });
  });
});
