import { webhooksSchema } from "./schema";

/**
 * The tables of the webhooks, for a product that applies them by hand. Idempotent. `ownerTable` is the product's account table.
 * @deprecated use `webhooksSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`; the SQL is the same.
 */
export function webhooksMigration(ownerTable = "accounts"): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ownerTable)) throw new Error("not a safe SQL identifier");
  return webhooksSchema.migrations[0]!.sql({ schema: "public", tables: { owner: ownerTable } });
}
