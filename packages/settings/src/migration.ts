import { settingsSchema } from "./schema";

/**
 * The tables of the settings, for a product that applies them by hand. Idempotent, safe on a database that already has them.
 * @deprecated use `settingsSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`; the SQL is the same.
 */
export function settingsMigration(): string {
  return settingsSchema.migrations[0]!.sql({ schema: "public", tables: {} });
}
