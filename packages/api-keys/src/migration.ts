import { apiKeysSchema } from "./schema";

/**
 * The table of API keys, for a product that applies it by hand. `ownerTable` is the product's account table.
 * @deprecated use `apiKeysSchema` with `emitMigration` (a new table) or `adoptMigration` (an existing one) from `@krizaka/db`; the SQL is the same.
 */
export function apiKeysMigration(ownerTable = "accounts"): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ownerTable)) throw new Error("not a safe SQL identifier");
  return apiKeysSchema.migrations[0]!.sql({ schema: "public", tables: { owner: ownerTable } });
}
