import { defineModule, type ModuleSchema } from "@krizaka/db";

import { type OrganizeSchema, organizeSql } from "./sql";

/**
 * « organize » as a versioned module (ADR-001 §3), generated from the product's declaration (owner table, collections, tags, kinds).
 * The tables stay where the product declares them (`public`, unqualified): a product that has them adopts version 1 with
 * `adoptMigration`, no DDL. The declaration is the module's arguments, so the product passes the same one to `emitMigration` and to
 * `createOrganize`. Version 1 is frozen once released: a change is version 2.
 */
export function organizeModuleSchema(declaration: OrganizeSchema): ModuleSchema {
  return defineModule({
    module: "organize",
    migrations: [{ version: 1, name: "collections_tags_and_defaults", sql: () => organizeSql(declaration) }],
  });
}
