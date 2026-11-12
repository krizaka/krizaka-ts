import crypto from "node:crypto";

import { addHours } from "@krizaka/time";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Query, signupInvitations, signupInvitationsSchema } from "../src";

/** Sign-up invitations against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-11-12T12:00:00Z");
const hash = (t: string) => crypto.createHmac("sha256", "test-key").update(t).digest("hex");
const days = (n: number) => addHours(NOW, n * 24);
const PILOT = { kind: "coupon", ref: "PILOT-2026" };

describe.runIf(enabled)("sign-up invitations on PostgreSQL", () => {
  const schemaName = `sui_${Math.random().toString(36).slice(2, 10)}`;
  let client: pg.Client;
  let query: Query;
  const invitations = (q: Query = (s, p) => query(s, p)) =>
    signupInvitations({ query: q, tokenPrefix: "ye", tokenHash: hash });
  const address = (label = "camille") => `${label}-${Math.random().toString(36).slice(2)}@test.example`;
  /** The product's transaction: its own connection, in the test's schema; rolled back when the work throws. */
  const transaction = async <T>(work: (q: Query) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query(`SET search_path TO ${schemaName}; BEGIN`);
      const result = await work(async (sql, params) => (await c.query(sql, params as unknown[])).rows as never);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined); // the original error is the one thrown
      throw error;
    } finally {
      await c.end();
    }
  };
  const stored = async (email: string) =>
    (await client.query("SELECT * FROM signup_invitations WHERE email = $1 ORDER BY created_at", [email])).rows;

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
    const sql = signupInvitationsSchema.migrations[0]!.sql({ schema: schemaName, tables: {} });
    await client.query(sql);
    await client.query(sql); // twice: safe
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await client.end();
  });

  it("invite → peek → redeem: the link shows the invited address, works once and hands back the grant and the inviter", async () => {
    const email = address();
    const { token, invitation } = await invitations().invite(
      { email: email.toUpperCase(), invitedBy: "admin-1", grant: PILOT },
      NOW,
    );
    expect(token).toMatch(/^ye1\.[A-Za-z0-9_-]{43}$/);
    expect(invitation).toMatchObject({ email, invitedBy: "admin-1", grant: PILOT, expiresAt: days(7) });
    expect(await invitations().peek(token, NOW)).toEqual({ email, expiresAt: days(7) });
    expect(await invitations().peek(token, NOW)).toEqual({ email, expiresAt: days(7) }); // read-only
    expect(await invitations().redeem(token, { email: email.toUpperCase() }, NOW)).toEqual({
      email,
      grant: PILOT,
      invitedBy: "admin-1",
    });
    await expect(invitations().peek(token, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });

  it("the token is never in the stored row: only its keyed hash", async () => {
    const email = address();
    const { token } = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    const [row] = await stored(email);
    expect(row.token_hash).toBe(hash(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token.slice(4));
    expect(row).toMatchObject({ grant_kind: null, grant_ref: null });
  });

  it("used twice: the second redemption is refused like an unknown link", async () => {
    const email = address();
    const { token } = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    expect((await invitations().redeem(token, { email }, NOW)).grant).toBeNull();
    await expect(invitations().redeem(token, { email }, NOW)).rejects.toMatchObject({
      code: "INVITE_INVALID",
      status: 400,
    });
  });

  it("expired: peek and redeem refuse it the moment its lifetime is over, and it leaves the pending list", async () => {
    const email = address();
    const { token, invitation } = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    const later = days(7);
    await expect(invitations().peek(token, later)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(invitations().redeem(token, { email }, later)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect((await invitations().pending(later)).map((i) => i.id)).not.toContain(invitation.id);
    expect((await invitations().pending(NOW)).map((i) => i.id)).toContain(invitation.id);
  });

  it("wrong address: refused, and the link stays good for the invited address", async () => {
    const email = address();
    const { token } = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    await expect(invitations().redeem(token, { email: address("other") }, NOW)).rejects.toMatchObject({
      code: "INVITE_WRONG_ADDRESS",
      status: 403,
    });
    await expect(invitations().redeem(token, { email: ` ${email}` }, NOW)).rejects.toMatchObject({
      code: "INVITE_WRONG_ADDRESS",
    });
    expect((await invitations().redeem(token, { email }, NOW)).email).toBe(email);
  });

  it("revoked: the link opens nothing, the row says who closed it, and it cannot be revoked twice", async () => {
    const email = address();
    const { token, invitation } = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    await invitations().revoke(invitation.id, "admin-2", NOW);
    await expect(invitations().peek(token, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(invitations().redeem(token, { email }, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(invitations().revoke(invitation.id, "admin-2", NOW)).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    await expect(invitations().resend(invitation.id, "admin-2", NOW)).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    expect((await stored(email))[0]).toMatchObject({ revoked_by: "admin-2", used_at: null });
    expect((await invitations().pending(NOW)).map((i) => i.email)).not.toContain(email);
  });

  it("a new invitation of the same address replaces the pending one: the old token opens nothing", async () => {
    const email = address();
    const first = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    const second = await invitations().invite({ email, invitedBy: "admin-2", grant: PILOT }, days(1));
    expect(second.token).not.toBe(first.token);
    expect(second.invitation.id).not.toBe(first.invitation.id);
    await expect(invitations().peek(first.token, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(invitations().redeem(first.token, { email }, NOW)).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    await expect(invitations().revoke(first.invitation.id, "admin-1", NOW)).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    expect((await stored(email)).length).toBe(1);
    expect(await invitations().redeem(second.token, { email }, NOW)).toEqual({
      email,
      grant: PILOT,
      invitedBy: "admin-2",
    });
    // once used, the address may be invited again (a new row; the used one stays)
    await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    expect((await stored(email)).length).toBe(2);
  });

  it("resend sends a new token for the same address and grant; the previous one stops working", async () => {
    const email = address();
    const first = await invitations().invite({ email, invitedBy: "admin-1", grant: PILOT }, NOW);
    const again = await invitations().resend(first.invitation.id, "admin-2", NOW);
    expect(again.token).not.toBe(first.token);
    expect(again.invitation).toMatchObject({ email, grant: PILOT, invitedBy: "admin-2" });
    await expect(invitations().peek(first.token, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect((await invitations().peek(again.token, NOW)).email).toBe(email);
  });

  it("pending lists the open invitations, oldest first, without any token", async () => {
    const [a, b] = [address("a"), address("b")];
    await invitations().invite({ email: a, invitedBy: "admin-1" }, NOW);
    await invitations().invite({ email: b, invitedBy: "admin-1", grant: PILOT }, days(1));
    const list = (await invitations().pending(days(2))).filter((i) => [a, b].includes(i.email));
    expect(list.map((i) => [i.email, i.grant])).toEqual([
      [a, null],
      [b, PILOT],
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual(["createdAt", "email", "expiresAt", "grant", "id", "invitedBy"]);
  });

  it("two concurrent redemptions in two transactions: exactly one wins", async () => {
    const email = address();
    const { token } = await invitations().invite({ email, invitedBy: "admin-1", grant: PILOT }, NOW);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        transaction(async (q) => {
          const got = await invitations(q).redeem(token, { email }, NOW);
          await q("SELECT pg_sleep(0.2)"); // the product creates the account in the same transaction
          return got;
        }),
      ),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toMatchObject({ code: "INVITE_INVALID" });
  });

  it("a redemption whose transaction rolls back leaves the link good", async () => {
    const email = address();
    const { token } = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    await expect(
      transaction(async (q) => {
        await invitations(q).redeem(token, { email }, NOW);
        throw new Error("the account could not be created");
      }),
    ).rejects.toThrow("the account could not be created");
    expect((await invitations().redeem(token, { email }, NOW)).email).toBe(email);
  });

  it("two concurrent invitations of one address leave one open invitation, and only its token works", async () => {
    const email = address();
    const sent = await Promise.all(
      [1, 2].map((n) => transaction((q) => invitations(q).invite({ email, invitedBy: `admin-${n}` }, NOW))),
    );
    const open = (await stored(email)).filter((r) => r.used_at === null && r.revoked_at === null);
    expect(open).toHaveLength(1);
    const peeks = await Promise.allSettled(sent.map((s) => invitations().peek(s.token, NOW)));
    expect(peeks.filter((p) => p.status === "fulfilled")).toHaveLength(1);
  });

  it("a re-invitation racing a redemption: the redemption wins or the old link is refused, never both", async () => {
    const email = address();
    const { token } = await invitations().invite({ email, invitedBy: "admin-1" }, NOW);
    const [redeemed, reinvited] = await Promise.allSettled([
      transaction(async (q) => {
        const got = await invitations(q).redeem(token, { email }, NOW);
        await q("SELECT pg_sleep(0.2)");
        return got;
      }),
      transaction((q) => invitations(q).invite({ email, invitedBy: "admin-2" }, NOW)),
    ]);
    expect(reinvited.status).toBe("fulfilled");
    const rows = await stored(email);
    if (redeemed.status === "fulfilled")
      expect(rows).toHaveLength(2); // the used one stays, the new one is open
    else expect(rows).toHaveLength(1);
    expect(rows.filter((r) => r.used_at === null && r.revoked_at === null)).toHaveLength(1);
  });
});
