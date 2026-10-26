import { webhooksSchema } from "./schema";

/**
 * The SQL of version 1 of the webhooks tables, for a product that runs it by hand (idempotent). `ownerTable` is the product's account table.
 * @deprecated Use `webhooksSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`: the SQL gets a version, a checksum and a marker. Removed in the next major.
 */
export function webhooksMigration(ownerTable = "accounts"): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ownerTable)) throw new Error("not a safe SQL identifier");
  return webhooksSchema.migrations[0]!.sql({ schema: "public", tables: { owner: ownerTable } });
}
