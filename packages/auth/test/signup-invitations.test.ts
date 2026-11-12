import { describe, expect, it } from "vitest";

import { type Query, SIGNUP_INVITATION_TTL_DAYS, signupInvitations, signupInvitationsSchema } from "../src";

const NOW = new Date("2026-11-12T12:00:00Z");
const TOKEN = `ye1.${"A".repeat(43)}`;

/** A query that records what it is asked and answers rows of an invitation (or nothing). */
const recording = (rows: unknown[] = []) => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const query = (async (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params });
    return rows;
  }) as Query;
  return { calls, query };
};
const service = (query: Query, extra: { ttlDays?: number; token?: () => string } = {}) =>
  signupInvitations({ query, tokenPrefix: "ye", tokenHash: (t) => `h:${t}`, ...extra });

describe("sign-up invitations, without a database", () => {
  it("refuses a lifetime outside a day to a month, or not in whole days", () => {
    const { query } = recording();
    expect(() => service(query, { ttlDays: 0 })).toThrow(RangeError);
    expect(() => service(query, { ttlDays: 31 })).toThrow(RangeError);
    expect(() => service(query, { ttlDays: 1.5 })).toThrow(RangeError);
    expect(() => service(query, { ttlDays: 30 })).not.toThrow();
    expect(SIGNUP_INVITATION_TTL_DAYS).toBe(7);
  });

  it("validates the address as given: spaces around it, no domain or too long are refused, not repaired", async () => {
    const { calls, query } = recording();
    for (const email of [
      " camille@test.example",
      "camille@test.example ",
      "camille",
      "a@b",
      `${"a".repeat(250)}@t.example`,
    ])
      await expect(service(query).invite({ email, invitedBy: "admin" }, NOW)).rejects.toMatchObject({
        code: "INVITE_BAD_ADDRESS",
        status: 400,
      });
    expect(calls).toEqual([]);
  });

  it("refuses a grant whose kind is not a plain name or whose reference is empty, and an empty inviter", async () => {
    const { calls, query } = recording();
    const invite = (grant: { kind: string; ref: string }, invitedBy = "admin") =>
      service(query).invite({ email: "camille@test.example", invitedBy, grant }, NOW);
    await expect(invite({ kind: "Coupon", ref: "PILOT" })).rejects.toMatchObject({ code: "INVITE_BAD_GRANT" });
    await expect(invite({ kind: "coupon", ref: "" })).rejects.toMatchObject({ code: "INVITE_BAD_GRANT" });
    await expect(invite({ kind: "coupon", ref: "x".repeat(201) })).rejects.toMatchObject({ code: "INVITE_BAD_GRANT" });
    await expect(invite({ kind: "coupon", ref: "PILOT" }, "")).rejects.toMatchObject({ code: "INVITE_BAD_ACTOR" });
    expect(calls).toEqual([]);
  });

  it("keeps only the token's hash, lower-cases the address and sets the expiry from the product's lifetime", async () => {
    const { calls, query } = recording([
      {
        id: "i",
        email: "camille@test.example",
        invited_by: "admin",
        grant_kind: "coupon",
        grant_ref: "PILOT",
        created_at: NOW,
        expires_at: NOW,
      },
    ]);
    const { token, invitation } = await service(query, { ttlDays: 3, token: () => TOKEN }).invite(
      { email: "Camille@Test.example", invitedBy: "admin", grant: { kind: "coupon", ref: "PILOT" } },
      NOW,
    );
    expect(token).toBe(TOKEN);
    expect(invitation.grant).toEqual({ kind: "coupon", ref: "PILOT" });
    const params = calls[0]!.params;
    expect(params).not.toContain(TOKEN);
    expect(params).toContain(`h:${TOKEN}`);
    expect(params).toContain("camille@test.example");
    expect(params).toContainEqual(new Date("2026-11-15T12:00:00Z"));
  });

  it("answers a malformed or foreign token like an unknown one, without a query", async () => {
    const { calls, query } = recording();
    for (const token of ["garbage", `ai1.${"A".repeat(43)}`, `ye1.${"A".repeat(42)}`, ""]) {
      await expect(service(query).peek(token, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID", status: 400 });
      await expect(service(query).redeem(token, { email: "c@test.example" }, NOW)).rejects.toMatchObject({
        code: "INVITE_INVALID",
      });
    }
    expect(calls).toEqual([]);
  });

  it("answers an id that is not one like an unknown invitation, without a query", async () => {
    const { calls, query } = recording();
    await expect(service(query).revoke("1; DROP", "admin", NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(service(query).resend("nope", "admin", NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect(calls).toEqual([]);
  });

  it("bounds the pending list", async () => {
    const { calls, query } = recording();
    await service(query).pending(NOW, 10_000);
    await service(query).pending(NOW, 0);
    expect(calls.map((c) => c.params[1])).toEqual([500, 1]);
  });

  it("the migration is idempotent SQL, keeps no token and allows one open invitation per address", () => {
    const sql = signupInvitationsSchema.migrations[0]!.sql({ schema: "public", tables: {} });
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS signup_invitations/);
    expect(sql).toMatch(/token_hash text NOT NULL UNIQUE/);
    expect(sql).not.toMatch(/\btoken text/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS signup_invitations_open ON signup_invitations\(email\) WHERE used_at IS NULL AND revoked_at IS NULL/,
    );
  });
});
