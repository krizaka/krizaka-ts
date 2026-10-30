import { emitMigration } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIncidentRegister, dbIncidentStore, privacySchema, type Query } from "../src";
import { incidentStoreContract } from "../src/testkit";

/** The incident register against a real PostgreSQL (CI's service, same switches as privacy.integration.test.ts). */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `pi_${Math.random().toString(36).slice(2, 10)}`;
const NOW = new Date("2026-10-27T12:00:00.000Z");

describe.runIf(enabled)("incident register: PostgreSQL", () => {
  let pool: pg.Pool;
  const query: Query = async (sql, params) => (await pool.query(sql, params)).rows as never;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    for (const version of [1, 2]) await pool.query(emitMigration(privacySchema, version, { tables: {}, schema }));
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  incidentStoreContract("pg incident store", async () => {
    await pool.query(`ALTER TABLE ${schema}.incident DISABLE TRIGGER incident_guard`);
    await pool.query(`TRUNCATE ${schema}.incident`);
    await pool.query(`ALTER TABLE ${schema}.incident ENABLE TRIGGER incident_guard`);
    return dbIncidentStore(query, schema);
  });

  it("keeps an entry until its retention ends and never lets it change register", async () => {
    const register = createIncidentRegister({ clock: { now: () => NOW }, schema });
    const actor = { id: null, label: "Admin" };
    const { id } = await register.open(
      query,
      { scope: "t1", kind: "loss", description: "A laptop was lost.", information: ["applicant file"] },
      actor,
    );
    await expect(query(`DELETE FROM ${schema}.incident WHERE id = $1`, [id])).rejects.toThrow(/retention/);
    await expect(query(`UPDATE ${schema}.incident SET scope = 't2' WHERE id = $1`, [id])).rejects.toThrow(/register/);
    await register.assess(
      query,
      "t1",
      id,
      {
        sensitivity: "low",
        consequences: "low",
        likelihood: "low",
        seriousInjury: false,
        rationale: "Encrypted disk.",
      },
      actor,
    );
    await register.close(query, "t1", id, actor);
    await expect(query(`UPDATE ${schema}.incident SET description = 'x' WHERE id = $1`, [id])).rejects.toThrow(
      /closed/,
    );
    expect(await register.get(query, "t2", id)).toBeNull();
  });
});
