import crypto from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accountsMigration, emailChangeMail, isEmailChangeToken, type Mail, postgresAccounts, type Query } from "../src";

/** The account adapter against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");
const PASSWORD = "correct-horse-battery";
const hash = (token: string) => crypto.createHash("sha256").update(`t:${token}`).digest("hex");
const passwords = { hash: async (p: string) => `h:${p}`, verify: async (p: string, stored: string) => stored === `h:${p}` };

describe("the e-mail change mail and token", () => {
  it("is in the person's language, names the product, carries the link and its validity", () => {
    const fr = emailChangeMail("Akinaza", "fr", "https://www.akinaza.com/fr/confirm-email?token=x");
    expect(fr.subject).toBe("Confirmez votre nouvelle adresse — Akinaza");
    expect(fr.text).toContain("https://www.akinaza.com/fr/confirm-email?token=x");
    expect(emailChangeMail("Akinaza", "en", "https://u").subject).toBe("Confirm your new address — Akinaza");
  });
  it("tokens carry the product's prefix", () => {
    expect(isEmailChangeToken("ae", `ae1.${"A".repeat(43)}`)).toBe(true);
    expect(isEmailChangeToken("ae", `ye1.${"A".repeat(43)}`)).toBe(false);
    expect(isEmailChangeToken("ae", "garbage")).toBe(false);
  });
  it("the migration is idempotent SQL and backfills only when asked", () => {
    expect(accountsMigration()).not.toMatch(/UPDATE accounts/);
    expect(accountsMigration({ backfillVerified: true })).toMatch(/UPDATE accounts SET email_verified_at = created_at/);
  });
});

describe.runIf(enabled)("the account service on PostgreSQL", () => {
  const schemaName = `auth_${Math.random().toString(36).slice(2, 10)}`;
  let client: pg.Client;
  let query: Query;
  const mails: Mail[] = [];
  const issued: string[] = [];
  const service = () =>
    postgresAccounts({
      query: (sql, params) => query(sql, params),
      mail: async (m) => void mails.push(m),
      baseUrl: "https://www.akinaza.com",
      product: "Akinaza",
      tokenPrefix: "ae",
      passwords,
      tokenHash: hash,
      token: () => {
        const t = `ae1.${crypto.randomBytes(32).toString("base64url")}`;
        issued.push(t);
        return t;
      },
    });
  const last = () => issued[issued.length - 1]!;
  const account = async () => {
    const email = `p-${Math.random().toString(36).slice(2)}@test.example`;
    const [row] = await query<{ id: string }>("INSERT INTO accounts (email, password_hash, locale) VALUES ($1, $2, 'fr') RETURNING id", [email, await passwords.hash(PASSWORD)]);
    return { id: row!.id, email };
  };
  const session = async (id: string, label: string, expires = "1 day") => (await query<{ id: string }>(`INSERT INTO sessions (account_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, now() + interval '${expires}', '203.0.113.9', $3) RETURNING id`, [id, `${label}${Math.random()}`, `agent-${label}`]))[0]!.id;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schemaName}; SET search_path TO ${schemaName}`);
    query = async (sql, params) => (await client.query(sql, params as unknown[])).rows as never;
    await client.query("CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, locale text NOT NULL DEFAULT 'fr', password_hash text, created_at timestamptz NOT NULL DEFAULT now())");
    await client.query("CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, token_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, ip text, user_agent text)");
    await client.query("INSERT INTO accounts (email) VALUES ('before@test.example')");
    await client.query(accountsMigration({ backfillVerified: true }));
    await client.query(accountsMigration({ backfillVerified: true })); // twice: safe
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await client.end();
  });

  it("an account that existed before the migration is verified; a new one is not", async () => {
    expect(await query("SELECT 1 FROM accounts WHERE email = 'before@test.example' AND email_verified_at IS NOT NULL")).toHaveLength(1);
    const { id } = await account();
    expect((await service().profile(id)).emailVerified).toBe(false);
  });

  it("reads and updates the profile: a trimmed name, the language, a theme, an avatar seed", async () => {
    const { id, email } = await account();
    expect(await service().profile(id)).toMatchObject({ email, name: null, locale: "fr", theme: null, avatarSeed: null, pendingEmail: null });
    expect(await service().updateProfile(id, { name: "  Éric   Tremblay ", locale: "en", theme: "dark", avatarSeed: "plain-3" })).toMatchObject({ name: "Éric Tremblay", locale: "en", theme: "dark", avatarSeed: "plain-3" });
    expect(await service().updateProfile(id, { name: null, theme: null })).toMatchObject({ name: null, theme: null, locale: "en" });
    await expect(service().updateProfile(id, { name: "x".repeat(81) })).rejects.toMatchObject({ status: 400 });
    await expect(service().updateProfile(id, { theme: "neon" as never })).rejects.toMatchObject({ status: 400 });
  });

  it("changes the e-mail address only after the new address confirms; the link works once and verifies the address", async () => {
    const { id } = await account();
    mails.length = 0;
    const next = `n-${Math.random().toString(36).slice(2)}@test.example`;
    await expect(service().requestEmailChange(id, { newEmail: next, password: "wrong" }, NOW)).rejects.toMatchObject({ status: 403, code: "WRONG_PASSWORD" });
    await service().requestEmailChange(id, { newEmail: next.toUpperCase(), password: PASSWORD }, NOW);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(next);
    expect(mails[0]!.locale).toBe("fr");
    expect(mails[0]!.text).toContain("/fr/confirm-email?token=ae1.");
    expect((await service().profile(id)).pendingEmail).toBe(next);
    expect(await service().confirmEmailChange(last(), NOW)).toBe("CHANGED");
    expect(await service().profile(id)).toMatchObject({ email: next, pendingEmail: null, emailVerified: true });
    expect(await service().confirmEmailChange(last(), NOW)).toBe("INVALID");
  });

  it("a link that expired, or is not a link, changes nothing; a taken address answers the same and mails nothing", async () => {
    const a = await account();
    const b = await account();
    await service().requestEmailChange(a.id, { newEmail: `e-${Math.random().toString(36).slice(2)}@test.example`, password: PASSWORD }, NOW);
    expect(await service().confirmEmailChange(last(), new Date("2026-10-24T12:00:01Z"))).toBe("INVALID");
    expect(await service().confirmEmailChange("garbage", NOW)).toBe("INVALID");
    for (const bad of ["not-an-email", "a@b", "@x.y", "a b@c.d", "a@@c.d", "a@c."]) await expect(service().requestEmailChange(a.id, { newEmail: bad, password: PASSWORD }, NOW)).rejects.toMatchObject({ status: 400 });
    mails.length = 0;
    await expect(service().requestEmailChange(a.id, { newEmail: b.email, password: PASSWORD }, NOW)).resolves.toBeUndefined();
    expect(mails).toHaveLength(0);
  });

  it("changes the password after checking the current one, and signs the other sessions out", async () => {
    const { id } = await account();
    const keep = await session(id, "keep");
    await session(id, "other");
    await expect(service().changePassword(id, { current: "wrong", next: "another-long-password" }, keep)).rejects.toMatchObject({ status: 403 });
    await expect(service().changePassword(id, { current: PASSWORD, next: "short" }, keep)).rejects.toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    await service().changePassword(id, { current: PASSWORD, next: "another-long-password" }, keep);
    expect((await query<{ id: string }>("SELECT id FROM sessions WHERE account_id = $1", [id])).map((s) => s.id)).toEqual([keep]);
  });

  it("lists the live sessions (the current one flagged, an expired one left out) and signs the others out", async () => {
    const { id } = await account();
    const here = await session(id, "here");
    await session(id, "there");
    await query("INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 day')", [id, `old${Math.random()}`]);
    const list = await service().sessions(id, new Date(), here);
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current).map((s) => s.id)).toEqual([here]);
    expect(list[0]).toMatchObject({ ip: "203.0.113.9" });
    expect(Object.keys(list[0]!)).not.toContain("tokenHash");
    expect(await service().signOutOthers(id, here)).toBe(2);
    expect((await service().sessions(id, new Date(), here)).map((s) => s.id)).toEqual([here]);
  });

  it("exports the person's data as one document, never a hash, with what the product adds", async () => {
    const { id, email } = await account();
    await session(id, "x");
    const out = await service().exportAccount(id, NOW, async () => ({ shops: [{ name: "Atelier" }] }));
    expect(out).toMatchObject({ exportedAt: NOW.toISOString(), account: { email }, shops: [{ name: "Atelier" }] });
    expect(JSON.stringify(out)).not.toMatch(/password|h:correct|token_hash/);
  });

  it("confirms a password and deletes the identity with its sessions", async () => {
    const { id } = await account();
    await session(id, "gone");
    await expect(service().confirmPassword(id, "nope")).rejects.toMatchObject({ status: 403, code: "WRONG_PASSWORD" });
    await service().confirmPassword(id, PASSWORD);
    await service().deleteAccount(id);
    expect(await query("SELECT 1 FROM accounts WHERE id = $1", [id])).toHaveLength(0);
    expect(await query("SELECT 1 FROM sessions WHERE account_id = $1", [id])).toHaveLength(0);
    await expect(service().deleteAccount(id)).rejects.toMatchObject({ status: 404 });
  });
});
