import { emitMigration, transaction } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPrivacy,
  dbPrivacyStore,
  type PrivacyContributor,
  privacySchema,
  type Query,
  type Subject,
} from "../src";
import { privacyStoreContract } from "../src/testkit";

/** « privacy » against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `pv_${Math.random().toString(36).slice(2, 10)}`;
const NOW = new Date("2026-10-26T12:00:00.000Z");
const ERIC: Subject = { kind: "account", id: "a1" };

describe.runIf(enabled)("privacy: PostgreSQL", () => {
  let pool: pg.Pool;
  const query: Query = async (sql, params) => (await pool.query(sql, params)).rows as never;
  const connect = async () => pool.connect();

  /** Two modules with real tables, as a product's would be. */
  const contributors: PrivacyContributor[] = [
    {
      name: "orders",
      exportFor: async (q, s) =>
        (await q<{ ref: string }>(`SELECT ref FROM ${schema}.orders WHERE owner = $1 ORDER BY ref`, [s.id])).map(
          (r) => r.ref,
        ),
      eraseFor: async (tx, s) => void (await tx(`DELETE FROM ${schema}.orders WHERE owner = $1`, [s.id])),
    },
    {
      name: "notes",
      exportFor: async (q, s) =>
        (await q<{ note: string }>(`SELECT note FROM ${schema}.notes WHERE owner = $1`, [s.id]))[0]?.note ?? null,
      eraseFor: async (tx, s) => void (await tx(`DELETE FROM ${schema}.notes WHERE owner = $1`, [s.id])),
      purgeExpired: async (tx, { before }) =>
        (await tx(`DELETE FROM ${schema}.notes WHERE created < $1 RETURNING 1`, [before])).length,
    },
  ];
  const privacy = (over: { contributors?: PrivacyContributor[] } = {}) =>
    createPrivacy({
      clock: { now: () => NOW },
      contributors: over.contributors ?? contributors,
      purposes: ["marketing", "screening"],
      transaction: (work) => transaction(connect, work),
      schema,
      retentionDays: (purpose) => (purpose === "marketing" ? 30 : undefined),
    });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    await pool.query(emitMigration(privacySchema, 1, { tables: {}, schema }));
    await pool.query(`CREATE TABLE ${schema}.orders (ref text PRIMARY KEY, owner text NOT NULL)`);
    await pool.query(
      `CREATE TABLE ${schema}.notes (owner text PRIMARY KEY, note text NOT NULL, created timestamptz NOT NULL)`,
    );
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });
  const seed = async () => {
    await pool.query(`TRUNCATE ${schema}.orders, ${schema}.notes, ${schema}.consent, ${schema}.request`);
    await pool.query(`INSERT INTO ${schema}.orders (ref, owner) VALUES ('o1', 'a1'), ('o2', 'a1'), ('o3', 'a2')`);
    await pool.query(
      `INSERT INTO ${schema}.notes (owner, note, created) VALUES ('a1', 'likes cats', $1), ('a2', 'likes dogs', $1)`,
      [NOW],
    );
  };

  privacyStoreContract("pg", async () => {
    await pool.query(`TRUNCATE ${schema}.consent, ${schema}.request`);
    return dbPrivacyStore(query, schema);
  });

  it("A CONSENT CANNOT BE EDITED: a trigger refuses an update, a withdrawal is a new row", async () => {
    await seed();
    const p = privacy();
    const consent = await p.recordConsent(query, {
      subject: ERIC,
      purpose: "marketing",
      version: "v1",
      granted: true,
      means: "checkbox",
    });
    await expect(query(`UPDATE ${schema}.consent SET granted = false WHERE id = $1`, [consent.id])).rejects.toThrow(
      /a consent is written once/,
    );
    await expect(query(`UPDATE ${schema}.consent SET version = 'v0'`)).rejects.toThrow(/written once/);
    await p.recordConsent(query, { subject: ERIC, purpose: "marketing", version: "v1", granted: false, means: "link" });
    expect(await p.hasConsent(query, ERIC, "marketing")).toBe(false);
    expect(await p.consentHistory(query, ERIC)).toHaveLength(2);
  });

  it("with two sample contributors, an export contains both, and an erasure leaves neither (in one transaction)", async () => {
    await seed();
    const p = privacy();
    await p.recordConsent(query, { subject: ERIC, purpose: "marketing", version: "v1", granted: true });
    const document = await p.exportSubject(query, ERIC);
    expect(document.modules).toEqual({ orders: ["o1", "o2"], notes: "likes cats" });
    const request = await p.eraseSubject(ERIC);
    expect(request).toMatchObject({ kind: "erasure", status: "completed" });
    expect((await p.exportSubject(query, ERIC)).modules).toEqual({ orders: [], notes: null });
    expect((await query(`SELECT count(*)::int AS n FROM ${schema}.orders WHERE owner = 'a2'`))[0]).toMatchObject({
      n: 1,
    }); // another person's data stays
    expect(await p.hasConsent(query, ERIC, "marketing")).toBe(false);
    const rows = await query<{ status: string; subject_id: string; failure: string | null }>(
      `SELECT status, subject_id, failure FROM ${schema}.request WHERE kind = 'erasure'`,
    );
    expect(rows).toEqual([{ status: "completed", subject_id: "a1", failure: null }]);
  });

  it("a contributor that fails rolls the WHOLE erasure back: the first module's data is still there, and the failure is recorded", async () => {
    await seed();
    const broken: PrivacyContributor = {
      name: "files",
      exportFor: async () => ({}),
      eraseFor: async () => {
        throw new Error("storage down");
      },
    };
    const p = privacy({ contributors: [...contributors, broken] });
    await expect(p.eraseSubject(ERIC)).rejects.toMatchObject({ code: "PRIVACY_CONTRIBUTOR_FAILED" });
    expect((await query(`SELECT count(*)::int AS n FROM ${schema}.orders WHERE owner = 'a1'`))[0]).toMatchObject({
      n: 2,
    });
    expect((await query(`SELECT count(*)::int AS n FROM ${schema}.notes WHERE owner = 'a1'`))[0]).toMatchObject({
      n: 1,
    });
    expect(await query(`SELECT kind, status, failure FROM ${schema}.request`)).toEqual([
      { kind: "erasure", status: "failed", failure: "CONTRIBUTOR_FAILED" },
    ]);
  });

  it("enforces the retention of a purpose through the contributors that implement it", async () => {
    await seed();
    await pool.query(`UPDATE ${schema}.notes SET created = $1 WHERE owner = 'a2'`, [new Date("2026-01-01T00:00:00Z")]);
    expect(await privacy().purge(query)).toEqual({ marketing: 1 }); // screening has no retention
    expect((await query(`SELECT owner FROM ${schema}.notes`)).map((r) => r.owner)).toEqual(["a1"]);
  });
});

describe("the database store's names", () => {
  it("refuses an unsafe schema name", () => {
    expect(() => dbPrivacyStore(async () => [], "privacy; DROP TABLE x")).toThrow(/DB_UNSAFE_IDENTIFIER/);
  });
});
