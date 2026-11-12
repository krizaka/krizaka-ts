import crypto from "node:crypto";

import type { Query } from "@krizaka/db";
import { addHours, isEmail } from "@krizaka/time";

import { isLinkToken, linkToken } from "./accounts";

/**
 * Invitation-only sign-up: while a product's sign-up is closed, its administration invites an e-mail address to create an account. An
 * instance-level object (no scope, no account yet), unlike `createRoles().invite`, which puts an existing account in a scope. The link is
 * the shared link token (`<prefix>1.<43 base64url>`, 256 random bits); only its keyed hash is kept; it works once, for the invited address
 * only, until it expires or is revoked. Rate limiting, the audit line and the mail are the product's.
 */

// @fixed: the default lifetime of a sign-up invitation, a security parameter: a week to open the mail, not a standing key
export const SIGNUP_INVITATION_TTL_DAYS = 7;
// @fixed: the shortest lifetime a product may set
export const SIGNUP_INVITATION_MIN_DAYS = 1;
// @fixed: the longest lifetime a product may set
export const SIGNUP_INVITATION_MAX_DAYS = 30;
// @fixed: the most pending invitations one read returns (a bounded read for the administration's list)
export const SIGNUP_INVITATION_PENDING_MAX = 500;

export const SIGNUP_INVITATION_CODE = {
  /** Unknown, expired, used or revoked alike: the answer never tells which. */
  invalid: "INVITE_INVALID",
  /** The token is good but the address is not the invited one. */
  wrongAddress: "INVITE_WRONG_ADDRESS",
  badAddress: "INVITE_BAD_ADDRESS",
  badGrant: "INVITE_BAD_GRANT",
  badActor: "INVITE_BAD_ACTOR",
} as const;
export type SignupInvitationCode = (typeof SIGNUP_INVITATION_CODE)[keyof typeof SIGNUP_INVITATION_CODE];
const STATUS: Record<SignupInvitationCode, number> = {
  INVITE_INVALID: 400,
  INVITE_WRONG_ADDRESS: 403,
  INVITE_BAD_ADDRESS: 400,
  INVITE_BAD_GRANT: 400,
  INVITE_BAD_ACTOR: 400,
};

export class SignupInvitationError extends Error {
  readonly status: number;
  constructor(readonly code: SignupInvitationCode) {
    super(code);
    this.name = "SignupInvitationError";
    this.status = STATUS[code];
  }
}

/** An entitlement the invitation carries, opaque to the library (Verikora: `{ kind: "coupon", ref: "<pilot code>" }`). Set by the inviter, never read from the client at redemption. */
export interface SignupGrant {
  kind: string;
  ref: string;
}

export interface SignupInvitation {
  id: string;
  email: string;
  invitedBy: string;
  grant: SignupGrant | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface SignupInvitationsDeps {
  /** The SQL executor. For `redeem`, build the invitations on the product's transaction so the account, the verified address and the grant land with it. */
  query: Query;
  /** The product's link token prefix (`ye` → `ye1.<43>`) and how it keeps a token (its keyed hash). */
  tokenPrefix: string;
  tokenHash: (token: string) => string;
  /** Days an invitation stays valid, from `SIGNUP_INVITATION_MIN_DAYS` to `SIGNUP_INVITATION_MAX_DAYS`; default `SIGNUP_INVITATION_TTL_DAYS`. */
  ttlDays?: number;
  token?: () => string;
}

const GRANT_KIND = /^[a-z][a-z0-9_-]{0,39}$/;
const TEXT_MAX = 200;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkTtl = (days: number): number => {
  if (!Number.isInteger(days) || days < SIGNUP_INVITATION_MIN_DAYS || days > SIGNUP_INVITATION_MAX_DAYS)
    throw new RangeError(
      `ttlDays must be a whole number from ${SIGNUP_INVITATION_MIN_DAYS} to ${SIGNUP_INVITATION_MAX_DAYS}, got ${days}`,
    );
  return days;
};
/** The original input is validated, never a trimmed copy: an address with spaces around it is refused, not repaired. */
const addressOf = (email: string): string => {
  if (!isEmail(email)) throw new SignupInvitationError(SIGNUP_INVITATION_CODE.badAddress);
  return email.toLowerCase();
};
const checkGrant = (grant: SignupGrant | null): SignupGrant | null => {
  if (grant && (!GRANT_KIND.test(grant.kind) || grant.ref.length === 0 || grant.ref.length > TEXT_MAX))
    throw new SignupInvitationError(SIGNUP_INVITATION_CODE.badGrant);
  return grant;
};
const checkActor = (actor: string): string => {
  if (actor.length === 0 || actor.length > TEXT_MAX) throw new SignupInvitationError(SIGNUP_INVITATION_CODE.badActor);
  return actor;
};

interface Row {
  id: string;
  email: string;
  invited_by: string;
  grant_kind: string | null;
  grant_ref: string | null;
  created_at: Date;
  expires_at: Date;
}
const COLUMNS = "id, email, invited_by, grant_kind, grant_ref, created_at, expires_at";
/** Still open: neither used nor revoked (it may have expired). */
const OPEN = "used_at IS NULL AND revoked_at IS NULL";
const invitationOf = (r: Row): SignupInvitation => ({
  id: r.id,
  email: r.email,
  invitedBy: r.invited_by,
  grant: r.grant_kind !== null && r.grant_ref !== null ? { kind: r.grant_kind, ref: r.grant_ref } : null,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

const invalid = () => new SignupInvitationError(SIGNUP_INVITATION_CODE.invalid);

/** What every operation shares: the query, the lifetime, how a token is made and kept. */
interface Context {
  query: Query;
  ttlDays: number;
  newToken: () => string;
  tokenHash: (token: string) => string;
  /** The hash of a token of the right shape; `null` for anything else, so a malformed link costs no query and answers like an unknown one. */
  hashOf: (token: string) => string | null;
}

async function invite(
  ctx: Context,
  input: { email: string; invitedBy: string; grant?: SignupGrant | null },
  now: Date,
): Promise<{ token: string; invitation: SignupInvitation }> {
  const email = addressOf(input.email);
  const invitedBy = checkActor(input.invitedBy);
  const grant = checkGrant(input.grant ?? null);
  const token = ctx.newToken();
  // One statement: the open invitation of the address, if any, takes the new token (the old one opens nothing any more);
  // two concurrent invitations of one address leave one open row (the partial unique index), never two.
  const [row] = await ctx.query<Row>(
    `INSERT INTO signup_invitations (id, email, token_hash, invited_by, grant_kind, grant_ref, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) WHERE ${OPEN} DO UPDATE SET id = excluded.id, token_hash = excluded.token_hash,
       invited_by = excluded.invited_by, grant_kind = excluded.grant_kind, grant_ref = excluded.grant_ref,
       created_at = excluded.created_at, expires_at = excluded.expires_at
     RETURNING ${COLUMNS}`,
    [
      crypto.randomUUID(),
      email,
      ctx.tokenHash(token),
      invitedBy,
      grant?.kind ?? null,
      grant?.ref ?? null,
      now,
      addHours(now, ctx.ttlDays * 24),
    ],
  );
  return { token, invitation: invitationOf(row!) };
}

async function peek(ctx: Context, token: string, now: Date): Promise<{ email: string; expiresAt: Date }> {
  const hash = ctx.hashOf(token);
  if (!hash) throw invalid();
  const [row] = await ctx.query<{ email: string; expires_at: Date }>(
    `SELECT email, expires_at FROM signup_invitations WHERE token_hash = $1 AND ${OPEN} AND expires_at > $2`,
    [hash, now],
  );
  if (!row) throw invalid();
  return { email: row.email, expiresAt: row.expires_at };
}

async function redeem(
  ctx: Context,
  token: string,
  input: { email: string },
  now: Date,
): Promise<{ email: string; grant: SignupGrant | null; invitedBy: string }> {
  const hash = ctx.hashOf(token);
  if (!hash) throw invalid();
  // One statement takes the invitation: of two concurrent redemptions, the second finds `used_at` set and gets no row.
  const [row] = await ctx.query<Row>(
    `UPDATE signup_invitations SET used_at = $3
      WHERE token_hash = $1 AND ${OPEN} AND expires_at > $3 AND email = $2
      RETURNING ${COLUMNS}`,
    [hash, input.email.toLowerCase(), now],
  );
  if (row) {
    const { email, grant, invitedBy } = invitationOf(row);
    return { email, grant, invitedBy };
  }
  const [open] = await ctx.query<{ id: string }>(
    `SELECT id FROM signup_invitations WHERE token_hash = $1 AND ${OPEN} AND expires_at > $2`,
    [hash, now],
  );
  throw open ? new SignupInvitationError(SIGNUP_INVITATION_CODE.wrongAddress) : invalid();
}

async function revoke(ctx: Context, id: string, actor: string, now: Date): Promise<void> {
  checkActor(actor);
  if (!ID.test(id)) throw invalid();
  const rows = await ctx.query<{ id: string }>(
    `UPDATE signup_invitations SET revoked_at = $2, revoked_by = $3 WHERE id = $1 AND ${OPEN} RETURNING id`,
    [id, now, actor],
  );
  if (rows.length === 0) throw invalid();
}

async function resend(
  ctx: Context,
  id: string,
  actor: string,
  now: Date,
): Promise<{ token: string; invitation: SignupInvitation }> {
  if (!ID.test(id)) throw invalid();
  const [row] = await ctx.query<Row>(`SELECT ${COLUMNS} FROM signup_invitations WHERE id = $1 AND ${OPEN}`, [id]);
  if (!row) throw invalid();
  const { email, grant } = invitationOf(row);
  return invite(ctx, { email, invitedBy: actor, grant }, now);
}

async function pending(ctx: Context, now: Date, limit: number): Promise<SignupInvitation[]> {
  const rows = await ctx.query<Row>(
    `SELECT ${COLUMNS} FROM signup_invitations WHERE ${OPEN} AND expires_at > $1 ORDER BY created_at, id LIMIT $2`,
    [now, Math.min(Math.max(1, Math.trunc(limit)), SIGNUP_INVITATION_PENDING_MAX)],
  );
  return rows.map(invitationOf);
}

/** The sign-up invitations of a product instance, over its PostgreSQL (`signupInvitationsSchema`). Time is passed in; nothing reads the clock. */
export function signupInvitations(deps: SignupInvitationsDeps) {
  const ctx: Context = {
    query: deps.query,
    ttlDays: checkTtl(deps.ttlDays ?? SIGNUP_INVITATION_TTL_DAYS),
    newToken: deps.token ?? (() => linkToken(deps.tokenPrefix)),
    tokenHash: deps.tokenHash,
    hashOf: (token) => (isLinkToken(deps.tokenPrefix, token) ? deps.tokenHash(token) : null),
  };
  return {
    /** Invites an address; answers the link token once (the product mails it). A new invitation of the address replaces the open one. */
    invite: (input: { email: string; invitedBy: string; grant?: SignupGrant | null }, now: Date) =>
      invite(ctx, input, now),
    /** The invited address of a valid link, to pre-fill and lock the sign-up form. Read-only. */
    peek: (token: string, now: Date) => peek(ctx, token, now),
    /**
     * Uses the link, once, for the invited address: run it in the product's transaction (build the invitations on its query), with the
     * account it creates. Of two concurrent redemptions exactly one gets the invitation. Redeeming proves the mailbox of the returned
     * `email`: the product may mark that exact address verified, and applies `grant` in the same transaction.
     */
    redeem: (token: string, input: { email: string }, now: Date) => redeem(ctx, token, input, now),
    /** Closes an invitation that is neither used nor revoked; its link opens nothing any more. */
    revoke: (id: string, actor: string, now: Date) => revoke(ctx, id, actor, now),
    /** Sends again: a new invitation of the same address and grant, with a new token (the stored one is a hash and is never sent). */
    resend: (id: string, actor: string, now: Date) => resend(ctx, id, actor, now),
    /** The invitations still valid, oldest first, for the administration's list. */
    pending: (now: Date, limit: number = SIGNUP_INVITATION_PENDING_MAX) => pending(ctx, now, limit),
  };
}
export type SignupInvitations = ReturnType<typeof signupInvitations>;
