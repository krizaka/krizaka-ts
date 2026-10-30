import { defineModule, type ModuleSchema } from "@krizaka/db";

import { type OrganizeSchema, organizeSql } from "./sql";
import { type WorkspaceDecl, workspaceSql } from "./workspace-schema";

/**
 * « organize » (collections, tags, the default collection) as a module (ADR-001 §3). The tables are the product's own names, given in the
 * declaration (`owner`, `collections`, `tags`, one table per kind), each checked by `ident()`, so the module declares no table role.
 * They existed before the module schemas: they stay in `public`, un-qualified, and a product that has them adopts version 1
 * (`adoptMigration`, markers only). Version 1 is frozen once released: a change is version 2.
 * @param declaration the product's declaration, as `organizeMigration` took it
 */
export function organizeSchema(declaration: OrganizeSchema): ModuleSchema {
  return defineModule({
    module: "organize",
    schema: "public",
    migrations: [{ version: 1, name: "collections and tags", sql: () => organizeSql(declaration) }],
  });
}

/**
 * The workspace layer (tags with markers, status sets, saved views; ADR-003) as a module, in a Postgres schema of its own (`organize` by
 * default, or the declaration's `schema`). The scope, the users and the kinds' entity tables are in the declaration, each checked by `ident()`.
 * @param declaration the product's declaration, as `workspaceMigration` took it
 */
export function workspaceSchema(declaration: WorkspaceDecl): ModuleSchema {
  return defineModule({
    module: "organize_workspace",
    schema: declaration.schema ?? "organize",
    migrations: [
      { version: 1, name: "tags, status, views", sql: (c) => workspaceSql({ ...declaration, schema: c.schema }) },
    ],
  });
}
