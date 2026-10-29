import { describe, expect, it } from "vitest";

import { checksumOf, DB_CODE, defineModule, emitMigration } from "../src";
import { assertEmbedded } from "../src/testing";

const accounts = defineModule({
  module: "accounts_extra",
  migrations: [{ version: 1, name: "a", sql: (c) => `CREATE TABLE ${c.schema}.a (id int);` }],
});
const audit = defineModule({
  module: "audit",
  requires: ["accounts_extra"],
  migrations: [
    { version: 1, name: "one", sql: (c) => `CREATE TABLE ${c.schema}.entry (id int);` },
    { version: 2, name: "two", sql: (c) => `CREATE INDEX i ON ${c.schema}.entry (id);` },
  ],
});
const context = { tables: {} };

describe("the products' drift test", () => {
  it("passes when every version is embedded, required modules first", () => {
    const files = [
      emitMigration(accounts, 1, context),
      "CREATE TABLE shops (id int);",
      emitMigration(audit, 1, context),
      emitMigration(audit, 2, context),
    ];
    expect(() =>
      assertEmbedded(files, [
        { schema: accounts, context },
        { schema: audit, context },
      ]),
    ).not.toThrow();
  });

  it("names every version a package upgrade brought and the product has not embedded yet", () => {
    const files = [emitMigration(accounts, 1, context), emitMigration(audit, 1, context)];
    expect(() =>
      assertEmbedded(files, [
        { schema: accounts, context },
        { schema: audit, context },
      ]),
    ).toThrow(expect.objectContaining({ code: DB_CODE.missingModules, details: ["audit v2"] }));
  });

  it("refuses an embedded version whose SQL no longer matches the package (a frozen version edited)", () => {
    const stale = emitMigration(audit, 1, context).replace(checksumOf(audit, 1, context), "f".repeat(64));
    const files = [emitMigration(accounts, 1, context), stale, emitMigration(audit, 2, context)];
    expect(() =>
      assertEmbedded(files, [
        { schema: accounts, context },
        { schema: audit, context },
      ]),
    ).toThrow(expect.objectContaining({ details: ["audit v1"] }));
  });

  it("refuses a module embedded before a module it requires", () => {
    const files = [
      emitMigration(audit, 1, context),
      emitMigration(audit, 2, context),
      emitMigration(accounts, 1, context),
    ];
    expect(() =>
      assertEmbedded(files, [
        { schema: accounts, context },
        { schema: audit, context },
      ]),
    ).toThrow(expect.objectContaining({ code: DB_CODE.order }));
  });
});
