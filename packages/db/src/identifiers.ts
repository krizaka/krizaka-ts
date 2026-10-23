import { DB_CODE, DbError } from "./port";

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * A SQL identifier from a product's declaration: lower-case letters, digits and underscores, at most 63 characters (the
 * PostgreSQL limit). Nothing else ever reaches SQL text.
 * @param name the table, schema or module name
 * @returns the same name
 * @throws DbError `DB_UNSAFE_IDENTIFIER`
 */
export function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new DbError(DB_CODE.unsafeIdentifier, [name]);
  return name;
}
