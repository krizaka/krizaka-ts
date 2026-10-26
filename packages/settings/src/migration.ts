import { settingsSchema } from "./schema";

/**
 * The SQL of version 1 of the settings tables, for a product that runs it by hand. Idempotent, safe on a database that already has them.
 * @deprecated Use `settingsSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`: the SQL gets a version, a checksum and a marker. Removed in the next major.
 */
export function settingsMigration(): string {
  return settingsSchema.migrations[0]!.sql({ schema: "public", tables: {} });
}
