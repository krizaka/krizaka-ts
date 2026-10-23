import { AUDIT_CODE, type AuditEntryInput, AuditError, type AuditInsert } from "./port";

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
 * @throws AuditError `AUDIT_BAD_ACTION`, `AUDIT_UNKNOWN_ACTION`, `AUDIT_BAD_LABEL`
 */
export function toInsert(input: AuditEntryInput, at: Date, allowedActions?: readonly string[]): AuditInsert {
  if (!ACTION.test(input.action) || input.action.length > 80) throw new AuditError(AUDIT_CODE.badAction, input.action);
  if (allowedActions && !allowedActions.includes(input.action)) throw new AuditError(AUDIT_CODE.unknownAction, input.action);
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
