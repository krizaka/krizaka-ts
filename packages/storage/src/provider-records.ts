import { defineModule } from "@krizaka/db";

import type { ResidencyLabel } from "./regions";
import { tenantKeysMigration } from "./tenant-keys";

/** The tables of the admin's providers (v1) and the tenants' wrapped keys of the managed storage (v2, ADR-020), in their own Postgres schema (ADR-001 §3). Version 1 is frozen once released: a change is version 2. */
export const storageSchema = defineModule({
  module: "storage",
  tables: [],
  migrations: [
    {
      version: 1,
      name: "providers",
      sql: (c) => `
CREATE TABLE ${c.schema}.provider (
  id                 uuid PRIMARY KEY,
  scope              text NOT NULL CHECK (scope = 'org' OR scope ~ '^user:[A-Za-z0-9_-]{1,64}$'),
  kind               text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]*$'),
  preset             text,
  label              text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  coordinates        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sealed_credentials text NOT NULL,
  key_id             text NOT NULL,
  status             text NOT NULL CHECK (status IN ('draft', 'verified', 'active', 'retiring', 'disabled')),
  source             text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'env')),
  last_test          jsonb,
  created_by         text,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL
);
CREATE INDEX provider_scope ON ${c.schema}.provider (scope, status);
CREATE TABLE ${c.schema}.default_provider (
  scope       text NOT NULL,
  data_kind   text NOT NULL CHECK (data_kind ~ '^[a-z][a-z0-9_-]*$'),
  provider_id uuid NOT NULL REFERENCES ${c.schema}.provider(id),
  PRIMARY KEY (scope, data_kind)
);`,
    },
    { version: 2, name: "tenant_keys", sql: (c) => tenantKeysMigration(c.schema) },
  ],
});

export const PROVIDER_STATUS = {
  draft: "draft",
  verified: "verified",
  active: "active",
  retiring: "retiring",
  disabled: "disabled",
} as const;
export type ProviderStatus = (typeof PROVIDER_STATUS)[keyof typeof PROVIDER_STATUS];

/** The last connection test: steps and the residency it found, never a value. */
export interface LastTest {
  ok: boolean;
  at: Date;
  steps: { name: string; ok: boolean; ms: number; error?: string }[];
  residency: ResidencyLabel;
}

/** A provider as stored. `sealedCredentials` leaves the service only to `openProvider`, never to a caller. */
export interface ProviderRecord {
  id: string;
  scope: string;
  kind: string;
  preset: string | null;
  label: string;
  coordinates: Record<string, string>;
  sealedCredentials: string;
  keyId: string;
  status: ProviderStatus;
  source: "admin" | "env";
  lastTest: LastTest | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Where the providers live. Every adapter runs `providerStoreContract` (`@krizaka/storage/testkit`). */
export interface ProviderStore {
  insert(record: ProviderRecord): Promise<void>;
  get(id: string): Promise<ProviderRecord | null>;
  /** Every provider of a scope (or all), oldest first. */
  list(scope?: string): Promise<ProviderRecord[]>;
  update(
    id: string,
    patch: Partial<
      Pick<
        ProviderRecord,
        "label" | "coordinates" | "sealedCredentials" | "keyId" | "status" | "lastTest" | "updatedAt"
      >
    >,
  ): Promise<ProviderRecord | null>;
  setDefault(scope: string, dataKind: string, providerId: string): Promise<void>;
  defaultFor(scope: string, dataKind: string): Promise<string | null>;
  defaults(scope: string): Promise<Record<string, string>>;
}
