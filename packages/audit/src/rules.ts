import { isIP } from "node:net";

import { AUDIT_CODE, type AuditEntryInput, AuditError, type AuditFilters, type AuditInsert } from "./port";
import { auditSettings } from "./settings";

/** The size of a page of the trail, for the admin. */
export const PAGE = {
  // @fixed: a page the admin reads at once; beyond it, the cursor.
  default: 50,
  // @fixed: the most one request may return, whatever the caller asks.
  max: 200,
} as const;

const ACTION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/**
 * Checks an entry against the trail's rules and the product's list of actions, and flattens it for a store.
 * @param input what the product records
 * @param at when (the injected clock)
 * @param allowedActions the product's actions, when it keeps a fixed list
 * @returns the row to write
 * @throws AuditError `AUDIT_BAD_ACTION`, `AUDIT_UNKNOWN_ACTION`, `AUDIT_BAD_LABEL`, `AUDIT_BAD_IP`
 */
export function toInsert(input: AuditEntryInput, at: Date, allowedActions?: readonly string[]): AuditInsert {
  if (!ACTION.test(input.action) || input.action.length > 80) throw new AuditError(AUDIT_CODE.badAction, input.action);
  if (allowedActions && !allowedActions.includes(input.action))
    throw new AuditError(AUDIT_CODE.unknownAction, input.action);
  if (input.ip != null && isIP(input.ip) === 0) throw new AuditError(AUDIT_CODE.badIp, input.ip);
  const label = input.actorLabel.trim();
  if (label.length < 1 || label.length > 120) throw new AuditError(AUDIT_CODE.badLabel, input.actorLabel);
  return {
    at,
    actorId: input.actorId,
    actorLabel: label,
    action: input.action,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    detail: input.detail ?? {},
    ip: input.ip ?? null,
  };
}

/**
 * The page size a store uses: the caller's, capped at `PAGE.max`, or `PAGE.default`.
 * @param limit the requested size (already checked by `checkFilters`)
 */
export const pageSize = (limit: number | undefined): number => Math.min(limit ?? PAGE.default, PAGE.max);

const CURSOR = /^[1-9][0-9]{0,18}$/;
/** PostgreSQL's largest `bigint`: an entry id, and so a cursor, is never above it. */
const BIGINT_MAX = 9_223_372_036_854_775_807n;

/**
 * Checks filters that may come from a request: a page size that is a positive integer, a cursor that is an entry id.
 * @throws AuditError `AUDIT_BAD_FILTER`
 */
export function checkFilters(filters: AuditFilters): void {
  if (filters.limit !== undefined && !(Number.isInteger(filters.limit) && filters.limit > 0))
    throw new AuditError(AUDIT_CODE.badFilter, `limit ${String(filters.limit)}`);
  if (filters.before !== undefined && !(CURSOR.test(filters.before) && BigInt(filters.before) <= BIGINT_MAX))
    throw new AuditError(AUDIT_CODE.badFilter, `before ${filters.before}`);
}

/**
 * Checks a retention against the setting's bounds, so a wrong value can never purge the whole trail.
 * @throws AuditError `AUDIT_BAD_RETENTION`
 */
export function checkRetention(days: number): void {
  const { min = 1, max = Number.MAX_SAFE_INTEGER } = auditSettings["audit.retentionDays"];
  if (!Number.isInteger(days) || days < min || days > max) throw new AuditError(AUDIT_CODE.badRetention, String(days));
}
