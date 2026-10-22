/**
 * The tables of the webhooks: an owner's endpoints, the deliveries queued for them (one per endpoint and event — queuing twice is a no-op),
 * and the inbound events already applied (so a replay changes nothing). Idempotent. `ownerTable` is the product's account table.
 */
export function webhooksMigration(ownerTable = "accounts"): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ownerTable)) throw new Error("not a safe SQL identifier");
  return `
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id            uuid PRIMARY KEY,
  owner_id      uuid NOT NULL REFERENCES ${ownerTable}(id) ON DELETE CASCADE,
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
`;
}
