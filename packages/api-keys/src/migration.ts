import { apiKeysSchema } from "./schema";

/**
 * The SQL of version 1 of the API keys table, for a product that runs it by hand. `ownerTable` is the product's account table.
 * @deprecated Use `apiKeysSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`: the SQL gets a version, a checksum and a marker. Removed in the next major.
 */
export function apiKeysMigration(ownerTable = "accounts"): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ownerTable)) throw new Error("not a safe SQL identifier");
  return apiKeysSchema.migrations[0]!.sql({ schema: "public", tables: { owner: ownerTable } });
}
