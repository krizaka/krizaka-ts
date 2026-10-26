import crypto from "node:crypto";

import type { Query } from "@krizaka/db";
import { addHours } from "date-fns";

/**
 * Roles per scope (a shop, a workspace), as DATA: a model says which roles exist, which permissions each holds and who may hand which
 * role to whom. The code asks `can(role, "invoices:write")`, never `if (role === "owner")`. One person may belong to several scopes, with
 * a role in each. Membership and invitations live in the product's PostgreSQL (see `rolesMigration`).
 */
export interface RoleModel<Role extends string = string, Permission extends string = string> {
  roles: readonly Role[];
  permissions: Record<Role, readonly Permission[]>;
  /** For each role, the roles it may invite, change and remove (the owner's, typically, is every role). */
  manages: Record<Role, readonly Role[]>;
}

export const defineRoles = <const Role extends string, const Permission extends string>(model: RoleModel<Role, Permission>): RoleModel<Role, Permission> => model;

export const can = <Role extends string, Permission extends string>(model: RoleModel<Role, Permission>, role: Role | null | undefined, permission: Permission): boolean => !!role && model.permissions[role].includes(permission);

export const ROLES_CODE = {
  forbidden: "FORBIDDEN",
  notMember: "NOT_A_MEMBER",
  unknownRole: "UNKNOWN_ROLE",
  lastOwner: "LAST_OWNER",
  notAllowed: "ROLE_NOT_ALLOWED",
  inviteInvalid: "INVITE_INVALID",
  inviteWrongAccount: "INVITE_WRONG_ACCOUNT",
} as const;
export type RolesCode = (typeof ROLES_CODE)[keyof typeof ROLES_CODE];
const STATUS: Record<RolesCode, number> = { FORBIDDEN: 403, NOT_A_MEMBER: 404, UNKNOWN_ROLE: 400, LAST_OWNER: 409, ROLE_NOT_ALLOWED: 403, INVITE_INVALID: 400, INVITE_WRONG_ACCOUNT: 403 };

export class RolesError extends Error {
  readonly status: number;
  constructor(readonly code: RolesCode) {
    super(code);
    this.name = "RolesError";
    this.status = STATUS[code];
  }
}

/** The SQL executor the roles take: `@krizaka/db`'s `Query`. */
export type RolesQuery = Query;

export interface RolesDeps<Role extends string, Permission extends string> {
  query: RolesQuery;
  model: RoleModel<Role, Permission>;
  /** The invitation link's token prefix (`ai` → `ai1.<43>`) and how the product keeps a token (its keyed hash). */
  tokenPrefix: string;
  tokenHash: (token: string) => string;
  /** Hours an invitation stays valid. */
  inviteTtlHours: number;
  token?: () => string;
}

export interface Member<Role extends string> {
  accountId: string;
  email: string;
  name: string | null;
  role: Role;
  since: Date;
}
export interface Invitation<Role extends string> {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

/** Who may do what in a scope, over the product's PostgreSQL. */
export function createRoles<Role extends string, Permission extends string>(deps: RolesDeps<Role, Permission>) {
  const { query, model } = deps;
  const known = (role: string): role is Role => (model.roles as readonly string[]).includes(role);
  const mustKnow = (role: string): Role => {
    if (!known(role)) throw new RolesError(ROLES_CODE.unknownRole);
    return role;
  };
  const newToken = deps.token ?? (() => `${deps.tokenPrefix}1.${crypto.randomBytes(32).toString("base64url")}`);
  const owners = (scopeId: string) => query<{ account_id: string }>("SELECT account_id FROM memberships WHERE scope_id = $1 AND role = $2", [scopeId, ownerRole()]);
  /** The role that cannot disappear: the first of the model that manages every role. */
  const ownerRole = (): Role => model.roles.find((r) => model.roles.every((x) => model.manages[r].includes(x) || x === r)) ?? model.roles[0]!;

  async function roleOf(accountId: string, scopeId: string): Promise<Role | null> {
    const [row] = await query<{ role: Role }>("SELECT role FROM memberships WHERE scope_id = $1 AND account_id = $2", [scopeId, accountId]);
    return row?.role ?? null;
  }

  return {
    ownerRole,
    roleOf,

    /** Every scope the person belongs to, with their role in it. */
    async scopesOf(accountId: string): Promise<{ scopeId: string; role: Role }[]> {
      return (await query<{ scope_id: string; role: Role }>("SELECT scope_id, role FROM memberships WHERE account_id = $1 ORDER BY created_at", [accountId])).map((r) => ({ scopeId: r.scope_id, role: r.role }));
    },

    /** The person's role in the scope if it holds the permission; otherwise `NOT_A_MEMBER` (404: nothing tells the scope exists) or `FORBIDDEN`. */
    async authorize(accountId: string, scopeId: string, permission: Permission): Promise<Role> {
      const role = await roleOf(accountId, scopeId);
      if (!role) throw new RolesError(ROLES_CODE.notMember);
      if (!can(model, role, permission)) throw new RolesError(ROLES_CODE.forbidden);
      return role;
    },

    /** Puts a person in a scope with a role (changing it if they are there): for a first owner, a seed, an accepted invitation. */
    async grant(scopeId: string, accountId: string, role: string, invitedBy: string | null, now: Date): Promise<void> {
      mustKnow(role);
      await query(
        "INSERT INTO memberships (scope_id, account_id, role, invited_by, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (scope_id, account_id) DO UPDATE SET role = excluded.role",
        [scopeId, accountId, role, invitedBy, now],
      );
    },

    async members(scopeId: string): Promise<Member<Role>[]> {
      const rows = await query<{ account_id: string; email: string; name: string | null; role: Role; created_at: Date }>(
        "SELECT m.account_id, a.email, a.name, m.role, m.created_at FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.scope_id = $1 ORDER BY m.created_at",
        [scopeId],
      );
      return rows.map((r) => ({ accountId: r.account_id, email: r.email, name: r.name, role: r.role, since: r.created_at }));
    },

    /** Changes someone's role. The actor must manage both the current and the new role; the last owner can never be demoted. */
    async setRole(scopeId: string, actor: { id: string }, target: string, role: string): Promise<void> {
      mustKnow(role);
      const mine = await roleOf(actor.id, scopeId);
      const current = await roleOf(target, scopeId);
      if (!mine || !current) throw new RolesError(ROLES_CODE.notMember);
      if (!model.manages[mine].includes(current) || !model.manages[mine].includes(role as Role)) throw new RolesError(ROLES_CODE.notAllowed);
      if (current === ownerRole() && role !== current && (await owners(scopeId)).length <= 1) throw new RolesError(ROLES_CODE.lastOwner);
      await query("UPDATE memberships SET role = $3 WHERE scope_id = $1 AND account_id = $2", [scopeId, target, role]);
    },

    /** Removes someone from the scope (or leaves it, when the target is the actor). The last owner cannot go. */
    async remove(scopeId: string, actor: { id: string }, target: string): Promise<void> {
      const mine = await roleOf(actor.id, scopeId);
      const current = await roleOf(target, scopeId);
      if (!mine || !current) throw new RolesError(ROLES_CODE.notMember);
      if (actor.id !== target && !model.manages[mine].includes(current)) throw new RolesError(ROLES_CODE.notAllowed);
      if (current === ownerRole() && (await owners(scopeId)).length <= 1) throw new RolesError(ROLES_CODE.lastOwner);
      await query("DELETE FROM memberships WHERE scope_id = $1 AND account_id = $2", [scopeId, target]);
    },

    /** Invites an e-mail address with a role the actor manages. The token is in the answer once (the product mails it); only its hash is kept. A new invitation for the same address replaces the pending one. */
    async invite(scopeId: string, actor: { id: string }, input: { email: string; role: string }, now: Date): Promise<{ token: string; invitation: Invitation<Role> }> {
      const role = mustKnow(input.role);
      const mine = await roleOf(actor.id, scopeId);
      if (!mine) throw new RolesError(ROLES_CODE.notMember);
      if (!model.manages[mine].includes(role)) throw new RolesError(ROLES_CODE.notAllowed);
      const email = input.email.trim().toLowerCase();
      await query("UPDATE invitations SET used_at = $3 WHERE scope_id = $1 AND email = $2 AND used_at IS NULL", [scopeId, email, now]);
      const token = newToken();
      const [row] = await query<{ id: string; created_at: Date; expires_at: Date }>(
        "INSERT INTO invitations (id, scope_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at, expires_at",
        [crypto.randomUUID(), scopeId, email, role, deps.tokenHash(token), actor.id, now, addHours(now, deps.inviteTtlHours)],
      );
      return { token, invitation: { id: row!.id, email, role, createdAt: row!.created_at, expiresAt: row!.expires_at } };
    },

    async pendingInvitations(scopeId: string, now: Date): Promise<Invitation<Role>[]> {
      const rows = await query<{ id: string; email: string; role: Role; created_at: Date; expires_at: Date }>("SELECT id, email, role, created_at, expires_at FROM invitations WHERE scope_id = $1 AND used_at IS NULL AND expires_at > $2 ORDER BY created_at", [scopeId, now]);
      return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at }));
    },

    async revokeInvitation(scopeId: string, actor: { id: string }, invitationId: string, now: Date): Promise<void> {
      const mine = await roleOf(actor.id, scopeId);
      if (!mine) throw new RolesError(ROLES_CODE.notMember);
      const [row] = await query<{ role: Role }>("SELECT role FROM invitations WHERE id = $1 AND scope_id = $2 AND used_at IS NULL", [invitationId, scopeId]);
      if (!row) throw new RolesError(ROLES_CODE.inviteInvalid);
      if (!model.manages[mine].includes(row.role)) throw new RolesError(ROLES_CODE.notAllowed);
      await query("UPDATE invitations SET used_at = $2 WHERE id = $1", [invitationId, now]);
    },

    /** The signed-in account takes the invitation: it must have been sent to this account's address; the link works once and expires. */
    async acceptInvitation(token: string, account: { id: string; email: string }, now: Date): Promise<{ scopeId: string; role: Role }> {
      const [row] = await query<{ id: string; scope_id: string; email: string; role: Role; invited_by: string | null }>(
        "SELECT id, scope_id, email, role, invited_by FROM invitations WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2",
        [deps.tokenHash(token), now],
      );
      if (!row) throw new RolesError(ROLES_CODE.inviteInvalid);
      if (row.email !== account.email.trim().toLowerCase()) throw new RolesError(ROLES_CODE.inviteWrongAccount);
      await query("UPDATE invitations SET used_at = $2 WHERE id = $1", [row.id, now]);
      const current = await roleOf(account.id, row.scope_id);
      // already in: keep the higher role (an invitation never demotes)
      if (!current || (model.manages[current].length < model.manages[row.role].length)) await query("INSERT INTO memberships (scope_id, account_id, role, invited_by, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (scope_id, account_id) DO UPDATE SET role = excluded.role", [row.scope_id, account.id, row.role, row.invited_by, now]);
      return { scopeId: row.scope_id, role: (!current || model.manages[current].length < model.manages[row.role].length ? row.role : current) as Role };
    },
  };
}
export type Roles<Role extends string = string, Permission extends string = string> = ReturnType<typeof createRoles<Role, Permission>>;
