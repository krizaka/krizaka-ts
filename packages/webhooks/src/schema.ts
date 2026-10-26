import { defineModule } from "@krizaka/db";

/**
 * The tables of the webhooks, declared as a module (ADR-001 §3): an owner's endpoints, the deliveries queued for them (one per endpoint
 * and event: queuing twice is a no-op), and the inbound events already applied (so a replay changes nothing). The one product table
 * referenced is the owner (`owner`: the product's account table). Idempotent.
 *
 * The tables existed before the module schemas, so they stay in `public`, un-qualified: a product that has them adopts version 1
 * (`adoptMigration`, markers only), one that does not emits it. Version 1 is frozen once released: a change is version 2.
 */
export const webhooksSchema = defineModule({
  module: "webhooks",
  schema: "public",
  tables: ["owner"],
  migrations: [
    {
      version: 1,
      name: "endpoints, deliveries, received events",
      sql: (c) => `
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id            uuid PRIMARY KEY,
  owner_id      uuid NOT NULL REFERENCES ${c.tables.owner}(id) ON DELETE CASCADE,
  url           text NOT NULL CHECK (char_length(url) <= 500),
  secret_sealed text NOT NULL,
  events        text[] NOT NULL CHECK (cardinality(events) > 0),
  active        boolean NOT NULL DEFAULT true,
  disabled_why  text,
  created_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_owner ON webhook_endpoints(owner_id);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              uuid PRIMARY KEY,
  endpoint_id     uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id        text NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  last_status     integer,
  last_error      text,
  created_at      timestamptz NOT NULL,
  delivered_at    timestamptz,
  UNIQUE (endpoint_id, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries(next_attempt_at) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS webhook_received (
  source      text NOT NULL,
  event_id    text NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (source, event_id)
);
`,
    },
  ],
});
