import { checksumOf, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { creditsSchema } from "../src";

describe("the credits schema", () => {
  it("version 1 is frozen: its checksum is pinned (a change is version 2)", () => {
    expect(checksumOf(creditsSchema, 1, { tables: { owner: "accounts" } })).toMatchInlineSnapshot(
      `"b5fe874f1d0744f78a24771c90e9a208885629585a4b783ed767c7f8ce9d3629"`,
    );
  });
  it("declares only the owner table, and every table is schema-qualified", () => {
    expect(creditsSchema.tables).toEqual(["owner"]);
    const sql = emitMigration(creditsSchema, 1, { tables: { owner: "accounts" } });
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS credits");
    expect(sql).toContain('credits."grant"');
    expect(sql).toContain("REFERENCES accounts(id)");
    expect(sql).toContain("append-only");
  });
  it("the ledger's lines are refused an update or a delete by a trigger, and a zero line is only an expiry", () => {
    const sql = emitMigration(creditsSchema, 1, { tables: { owner: "accounts" } });
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON credits.entry");
    expect(sql).toContain("CHECK (amount <> 0 OR type = 'EXPIRY')");
  });
});
