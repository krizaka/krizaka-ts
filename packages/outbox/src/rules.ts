import { OUTBOX_CODE, type OutboxInput, OutboxError } from "./port";
import type { OutboxSettings } from "./settings";

/** The cap of the retry delay: a day. */
// @fixed: the delay doubles up to a day, whatever the admin's first delay.
export const MAX_BACKOFF_SECONDS = 86_400;

/** The longest error text kept on a message. */
// @fixed: enough to diagnose, small enough never to bloat the table.
export const MAX_ERROR_LENGTH = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZES = {
  batchSize: [1, 500],
  leaseSeconds: [10, 3600],
  maxAttempts: [1, 50],
  backoffSeconds: [1, 3600],
} as const;

/**
 * The delay before the next try after `attempts` tries: the first delay, doubling, capped.
 * @param attempts how many times the message was claimed (1 after the first)
 * @param base the first delay in seconds (`outbox.backoffSeconds`)
 * @param cap the longest delay in seconds
 * @returns seconds
 */
export function backoffSeconds(attempts: number, base: number, cap = MAX_BACKOFF_SECONDS): number {
  return Math.min(cap, base * 2 ** (Math.min(Math.max(attempts, 1), 31) - 1));
}

/**
 * Checks what a product appends.
 * @throws OutboxError `OUTBOX_BAD_MESSAGE`
 */
export function checkInput(input: OutboxInput): void {
  if (input.topic.trim().length < 1 || input.topic.length > 120) throw new OutboxError(OUTBOX_CODE.badMessage, `topic: ${input.topic}`);
  if (input.type.trim().length < 1 || input.type.length > 160) throw new OutboxError(OUTBOX_CODE.badMessage, `type: ${input.type}`);
  if (input.payload === null || typeof input.payload !== "object" || Array.isArray(input.payload)) throw new OutboxError(OUTBOX_CODE.badMessage, "payload: an object is expected");
  if (input.id !== undefined && !UUID.test(input.id)) throw new OutboxError(OUTBOX_CODE.badMessage, `id: ${input.id}`);
}

/**
 * Checks a claim's request, so a bad value never reaches SQL.
 * @throws OutboxError `OUTBOX_BAD_CLAIM`
 */
export function checkClaim(options: { limit: number; leaseSeconds: number; owner: string }): void {
  const [maxLimit, maxLease] = [SIZES.batchSize[1], SIZES.leaseSeconds[1]];
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > maxLimit) throw new OutboxError(OUTBOX_CODE.badClaim, `limit: ${options.limit}`);
  if (!Number.isInteger(options.leaseSeconds) || options.leaseSeconds < 1 || options.leaseSeconds > maxLease) throw new OutboxError(OUTBOX_CODE.badClaim, `leaseSeconds: ${options.leaseSeconds}`);
  if (options.owner.trim().length < 1 || options.owner.length > 200) throw new OutboxError(OUTBOX_CODE.badClaim, "owner");
}

/**
 * Checks the settings the product resolved against the registry's bounds.
 * @throws OutboxError `OUTBOX_BAD_SETTINGS`
 */
export function checkSettings(settings: OutboxSettings): void {
  for (const key of Object.keys(SIZES) as (keyof OutboxSettings)[]) {
    const [min, max] = SIZES[key];
    const value = settings[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new OutboxError(OUTBOX_CODE.badSettings, `${key}: ${value}`);
  }
}

/** What is kept of an error: its message, trimmed to `MAX_ERROR_LENGTH`. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}
