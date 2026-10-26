import { defineModule } from "@krizaka/db";

/**
 * The table of counters of « rate-limit », in its own Postgres schema (ADR-001 §3). One row per key holds the open window: its count,
 * when it started and when it ends. It references no product table. Version 1 is frozen once released: a change is version 2.
 */
export const rateLimitSchema = defineModule({
  module: "rate_limit",
  migrations: [
    {
      version: 1,
      name: "buckets",
      sql: (c) => `
CREATE TABLE ${c.schema}.bucket (
  key          text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 300),
  count        integer NOT NULL CHECK (count >= 0),
  window_start timestamptz NOT NULL,
  reset_at     timestamptz NOT NULL
);
CREATE INDEX bucket_reset_at ON ${c.schema}.bucket (reset_at);`,
    },
  ],
});
