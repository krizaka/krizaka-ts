import crypto from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { can, createRoles, defineRoles, rolesMigration, type RolesQuery } from "../src";

/** The model of a shop: three roles, the permissions each holds, who may hand which role to whom — data, never `if (role === …)`. */
const SHOP = defineRoles({
  roles: ["owner", "manager", "staff"],
  permissions: {
    owner: ["bookings", "clients", "invoices", "agenda", "billing", "delete"],
    manager: ["bookings", "clients", "invoices", "agenda"],
    staff: ["bookings", "agenda"],
  },
  manages: { owner: ["owner", "manager", "staff"], manager: ["staff"], staff: [] },
});
type Permission = "bookings" | "clients" | "invoices" | "agenda" | "billing" | "delete";
const PERMISSIONS: Permission[] = ["bookings", "clients", "invoices", "agenda", "billing", "delete"];

describe("the permission table", () => {
  const expected: Record<string, Permission[]> = {
    owner: PERMISSIONS,
    manager: ["bookings", "clients", "invoices", "agenda"],
    staff: ["bookings", "agenda"],
  };
  it.each(Object.entries(expected))("%s holds exactly its permissions", (role, allowed) => {
    for (const p of PERMISSIONS) expect(can(SHOP, role as "owner", p), `${role} ${p}`).toBe(allowed.includes(p));
  });
  it("no role, no permission", () => {
    expect(can(SHOP, null, "bookings")).toBe(false);
    expect(can(SHOP, undefined, "bookings")).toBe(false);
  });
});

/** Memberships and invitations against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");
const hash = (t: string) => crypto.createHash("sha256").update(`i:${t}`).digest("hex");

describe.runIf(enabled)("roles on PostgreSQL", () => {
  const schemaName = `rol_${Math.random().toString(36).slice(2, 10)}`;
  let client: pg.Client;
  let query: RolesQuery;
  const roles = () =>
    createRoles({ query: (s, p) => query(s, p), model: SHOP, tokenPrefix: "ai", tokenHash: hash, inviteTtlHours: 72 });
  const account = async (label = "a") => {
    const email = `${label}-${Math.random().toString(36).slice(2)}@test.example`;
    return {
      id: (await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [email]))[0]!.id,
      email,
    };
  };
  const shop = async () => (await query<{ id: string }>("INSERT INTO shops (name) VALUES ('S') RETURNING id"))[0]!.id;

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
      "CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text)",
    );
    await client.query("CREATE TABLE shops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)");
    await client.query(rolesMigration(SHOP.roles, { scopeTable: "shops" }));
    await client.query(rolesMigration(SHOP.roles, { scopeTable: "shops" })); // twice: safe
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await client.end();
  });

  it("authorizes by the permission table, per scope: a role in one shop says nothing of another", async () => {
    const [s1, s2] = [await shop(), await shop()];
    const [owner, staff, stranger] = [await account("o"), await account("s"), await account("x")];
    await roles().grant(s1, owner.id, "owner", null, NOW);
    await roles().grant(s1, staff.id, "staff", owner.id, NOW);
    await roles().grant(s2, staff.id, "manager", owner.id, NOW); // one person, two shops, a role in each
    expect(await roles().authorize(staff.id, s1, "bookings")).toBe("staff");
    await expect(roles().authorize(staff.id, s1, "invoices")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await roles().authorize(staff.id, s2, "invoices")).toBe("manager");
    await expect(roles().authorize(stranger.id, s1, "bookings")).rejects.toMatchObject({
      code: "NOT_A_MEMBER",
      status: 404,
    });
    expect(await roles().scopesOf(staff.id)).toEqual([
      { scopeId: s1, role: "staff" },
      { scopeId: s2, role: "manager" },
    ]);
    await expect(roles().grant(s1, stranger.id, "admin", null, NOW)).rejects.toMatchObject({ code: "UNKNOWN_ROLE" });
    expect((await roles().members(s1)).map((m) => [m.email, m.role])).toEqual([
      [owner.email, "owner"],
      [staff.email, "staff"],
    ]);
  });

  it("invites by e-mail with a role the inviter manages; the link works once, for that address only, and expires", async () => {
    const s = await shop();
    const [owner, manager, camille] = [await account("o"), await account("m"), await account("camille")];
    await roles().grant(s, owner.id, "owner", null, NOW);
    await roles().grant(s, manager.id, "manager", owner.id, NOW);
    await expect(roles().invite(s, manager, { email: camille.email, role: "manager" }, NOW)).rejects.toMatchObject({
      code: "ROLE_NOT_ALLOWED",
    });
    const { token, invitation } = await roles().invite(
      s,
      manager,
      { email: ` ${camille.email.toUpperCase()} `, role: "staff" },
      NOW,
    );
    expect(token).toMatch(/^ai1\./);
    expect(JSON.stringify(await roles().pendingInvitations(s, NOW))).not.toContain(token);
    expect((await roles().pendingInvitations(s, NOW)).map((i) => [i.email, i.role])).toEqual([
      [camille.email, "staff"],
    ]);
    const other = await account("other");
    await expect(roles().acceptInvitation(token, other, NOW)).rejects.toMatchObject({ code: "INVITE_WRONG_ACCOUNT" });
    expect(await roles().acceptInvitation(token, camille, NOW)).toEqual({ scopeId: s, role: "staff" });
    expect(await roles().roleOf(camille.id, s)).toBe("staff");
    await expect(roles().acceptInvitation(token, camille, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    const again = await roles().invite(s, owner, { email: camille.email, role: "manager" }, NOW);
    await expect(
      roles().acceptInvitation(again.token, camille, new Date(NOW.getTime() + 73 * 3600_000)),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect(invitation.expiresAt.getTime() - NOW.getTime()).toBe(72 * 3600_000);
  });

  it("a new invitation replaces the pending one for the address; one can be revoked; an invitation never demotes", async () => {
    const s = await shop();
    const [owner, member] = [await account("o"), await account("m")];
    await roles().grant(s, owner.id, "owner", null, NOW);
    await roles().grant(s, member.id, "manager", owner.id, NOW);
    const first = await roles().invite(s, owner, { email: member.email, role: "staff" }, NOW);
    const second = await roles().invite(s, owner, { email: member.email, role: "staff" }, NOW);
    expect(await roles().pendingInvitations(s, NOW)).toHaveLength(1);
    await expect(roles().acceptInvitation(first.token, member, NOW)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect(await roles().acceptInvitation(second.token, member, NOW)).toEqual({ scopeId: s, role: "manager" }); // stays manager
    const third = await roles().invite(s, owner, { email: `z-${member.email}`, role: "staff" }, NOW);
    await roles().revokeInvitation(s, owner, third.invitation.id, NOW);
    expect(await roles().pendingInvitations(s, NOW)).toEqual([]);
  });

  it("changes and removes roles within what the actor manages — and the last owner can never go", async () => {
    const s = await shop();
    const [owner, manager, staff] = [await account("o"), await account("m"), await account("s")];
    await roles().grant(s, owner.id, "owner", null, NOW);
    await roles().grant(s, manager.id, "manager", owner.id, NOW);
    await roles().grant(s, staff.id, "staff", owner.id, NOW);
    await expect(roles().setRole(s, manager, staff.id, "manager")).rejects.toMatchObject({ code: "ROLE_NOT_ALLOWED" });
    await expect(roles().setRole(s, manager, owner.id, "staff")).rejects.toMatchObject({ code: "ROLE_NOT_ALLOWED" });
    await roles().setRole(s, owner, staff.id, "manager");
    expect(await roles().roleOf(staff.id, s)).toBe("manager");
    await expect(roles().setRole(s, owner, owner.id, "manager")).rejects.toMatchObject({ code: "LAST_OWNER" });
    await expect(roles().remove(s, owner, owner.id)).rejects.toMatchObject({ code: "LAST_OWNER" });
    await roles().setRole(s, owner, manager.id, "owner");
    await roles().remove(s, owner, owner.id); // two owners: one may leave
    expect(await roles().roleOf(owner.id, s)).toBeNull();
    await roles().remove(s, staff, staff.id); // anyone may leave
    expect((await roles().members(s)).map((m) => m.role)).toEqual(["owner"]);
  });
});
