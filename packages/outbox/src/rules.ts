import { OUTBOX_CODE, OutboxError, type OutboxSettings } from "./port";

/**
 * The defaults of the settings, and their bounds. The settings fragment (`@krizaka/outbox/settings`) is built from these, so the
 * admin sees the same numbers the code falls back to.
 */
// @fixed: the defaults and bounds of the admin's knobs; the admin chooses within them
export const OUTBOX_DEFAULTS: OutboxSettings = { batchSize: 50, leaseSeconds: 60, maxAttempts: 8, backoffSeconds: 30, backoffMaxSeconds: 3600, retentionDays: 7 };

/** The bounds of each setting: [min, max]. */
// @fixed: what an admin may set
export const OUTBOX_BOUNDS: Readonly<Record<keyof OutboxSettings, readonly [number, number]>> = {
  batchSize: [1, 500],
  leaseSeconds: [10, 3600],
  maxAttempts: [1, 50],
  backoffSeconds: [1, 3600],
  backoffMaxSeconds: [1, 86_400],
  retentionDays: [1, 365],
};

const TOPIC = /^[a-z][a-z0-9_.:-]{0,59}$/;
const TYPE = /^[a-z][a-z0-9_.-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @throws OutboxError for a topic, a type or an id that is not well formed, or a payload that is not JSON */
export function checkMessage(input: { topic: string; type: string; id?: string; payload: unknown }): void {
  if (!TOPIC.test(input.topic)) throw new OutboxError(OUTBOX_CODE.badTopic, `topic « ${input.topic} »: lower-case letters, digits and _ . : -, starting with a letter, at most 60 characters`);
  if (!TYPE.test(input.type)) throw new OutboxError(OUTBOX_CODE.badType, `type « ${input.type} »: lower-case letters, digits and _ . -, starting with a letter, at most 100 characters (evt.credit.granted.v1)`);
  if (input.id !== undefined && !UUID.test(input.id)) throw new OutboxError(OUTBOX_CODE.badId, `id « ${input.id} » is not a UUID`);
  if (input.payload === undefined || JSON.stringify(input.payload) === undefined) throw new OutboxError(OUTBOX_CODE.badPayload, "the payload must be JSON-serialisable (and not undefined)");
}

/** @throws OutboxError when a setting is not a whole number within its bounds */
export function checkSettings(settings: OutboxSettings): OutboxSettings {
  for (const key of Object.keys(OUTBOX_BOUNDS) as (keyof OutboxSettings)[]) {
    const [min, max] = OUTBOX_BOUNDS[key];
    const value = settings[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new OutboxError(OUTBOX_CODE.badSettings, `outbox.${key} must be a whole number from ${min} to ${max}, got ${value}`);
  }
  return settings;
}

/**
 * The seconds a message waits after its `attempts`-th delivery failed: the base for the first, doubling with each, capped.
 * @param attempts deliveries started so far (1 for the first failure)
 */
export function backoffSeconds(attempts: number, settings: Pick<OutboxSettings, "backoffSeconds" | "backoffMaxSeconds">): number {
  return Math.min(settings.backoffMaxSeconds, settings.backoffSeconds * 2 ** Math.max(0, attempts - 1));
}
