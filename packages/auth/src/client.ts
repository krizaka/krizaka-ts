// The browser entry of `@krizaka/auth`: what a client component may import (`can`, the role model, the error codes, the `/api/me` contract).
// Nothing here may load a `node:*` module — `tests/browser-safe` (repository root) bundles this file for the browser and fails otherwise.
export * from "./contract";
export { can, defineRoles, type RoleModel, ROLES_CODE, type RolesCode, RolesError } from "./roles-model";
