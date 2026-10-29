// The browser-safe half of the roles: the model as data, `can` and the error codes. No `node:*` import, no database: a client component imports it from `@krizaka/auth/client`.

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

export const defineRoles = <const Role extends string, const Permission extends string>(
  model: RoleModel<Role, Permission>,
): RoleModel<Role, Permission> => model;

export const can = <Role extends string, Permission extends string>(
  model: RoleModel<Role, Permission>,
  role: Role | null | undefined,
  permission: Permission,
): boolean => !!role && model.permissions[role].includes(permission);

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
const STATUS: Record<RolesCode, number> = {
  FORBIDDEN: 403,
  NOT_A_MEMBER: 404,
  UNKNOWN_ROLE: 400,
  LAST_OWNER: 409,
  ROLE_NOT_ALLOWED: 403,
  INVITE_INVALID: 400,
  INVITE_WRONG_ACCOUNT: 403,
};

export class RolesError extends Error {
  readonly status: number;
  constructor(readonly code: RolesCode) {
    super(code);
    this.name = "RolesError";
    this.status = STATUS[code];
  }
}
