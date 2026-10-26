import { defineModule } from "@krizaka/db";

/**
 * The tables of « privacy », in their own Postgres schema (ADR-001 §3). They reference no product table: a subject is a kind and an
 * id the product chooses (an account, a client file, an application).
 *
 * - `consent` is WRITTEN ONCE: a trigger refuses any update. A withdrawal is a new row; the consent with the last word (highest `seq`) wins.
 * - `request` is the record of an export or an erasure: when, of what kind, how it ended. It holds an id and no other personal data,
 *   so it can outlive the erasure it proves.
 *
 * Version 1 is frozen once released: a change is version 2.
 */
export const privacySchema = defineModule({
  module: "privacy",
  migrations: [
    {
      version: 1,
      name: "consents and requests",
      sql: (c) => `
CREATE TABLE ${c.schema}.consent (
  seq          bigserial UNIQUE,
  id           uuid PRIMARY KEY,
  subject_kind text NOT NULL CHECK (subject_kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  subject_id   text NOT NULL CHECK (char_length(subject_id) BETWEEN 1 AND 200),
  purpose      text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_-]{0,39}$'),
  version      text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 100),
  granted      boolean NOT NULL,
  means        text CHECK (means IS NULL OR char_length(means) <= 40),
  at           timestamptz NOT NULL
);
CREATE INDEX consent_subject ON ${c.schema}.consent (subject_kind, subject_id, purpose, seq DESC);
CREATE FUNCTION ${c.schema}.consent_written_once() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'a consent is written once: a withdrawal is a new row' USING ERRCODE = 'restrict_violation';
END;
$fn$;
CREATE TRIGGER consent_written_once BEFORE UPDATE ON ${c.schema}.consent FOR EACH ROW EXECUTE FUNCTION ${c.schema}.consent_written_once();
CREATE TABLE ${c.schema}.request (
  id           uuid PRIMARY KEY,
  subject_kind text NOT NULL CHECK (subject_kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  subject_id   text NOT NULL CHECK (char_length(subject_id) BETWEEN 1 AND 200),
  kind         text NOT NULL CHECK (kind IN ('export', 'erasure')),
  status       text NOT NULL CHECK (status IN ('requested', 'completed', 'failed')),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure      text CHECK (failure IS NULL OR char_length(failure) <= 100)
);
CREATE INDEX request_subject ON ${c.schema}.request (subject_kind, subject_id, requested_at DESC);`,
    },
  ],
});
