import { compareAsc } from "date-fns";

import type { Query } from "./accounts";
import { identityLinksSchema } from "./schema";

/**
 * Which external identity belongs to which account. Never a second user table: a row is only `(issuer, subject) → account`.
 * The product's `accounts` stays the one place a person lives.
 */
export interface IdentityLinkStore {
  /** The account this external identity is linked to, or null. */
  find(issuer: string, subject: string): Promise<string | null>;
  /** Links it. Idempotent for the same account; throws when the identity is already linked to another one. */
  link(accountId: string, issuer: string, subject: string, now: Date): Promise<void>;
  /** Removes the link (the person unlinks Google); true when there was one. */
  unlink(accountId: string, issuer: string, subject: string): Promise<boolean>;
  /** The identities linked to an account, oldest first. */
  list(accountId: string): Promise<{ issuer: string; subject: string; linkedAt: Date }[]>;
}

export class IdentityLinkError extends Error {
  readonly code = "ALREADY_LINKED";
  constructor() {
    super("That external identity is already linked to another account");
    this.name = "IdentityLinkError";
  }
}

/** An in-memory store: the tests' adapter, and the reference the contract is written against. */
export function memoryIdentityLinks(): IdentityLinkStore {
  const rows = new Map<string, { accountId: string; issuer: string; subject: string; linkedAt: Date }>();
  const key = (issuer: string, subject: string) => `${issuer}\n${subject}`;
  return {
    async find(issuer, subject) {
      return rows.get(key(issuer, subject))?.accountId ?? null;
    },
    async link(accountId, issuer, subject, now) {
      const existing = rows.get(key(issuer, subject));
      if (existing && existing.accountId !== accountId) throw new IdentityLinkError();
      if (!existing) rows.set(key(issuer, subject), { accountId, issuer, subject, linkedAt: now });
    },
    async unlink(accountId, issuer, subject) {
      const existing = rows.get(key(issuer, subject));
      if (existing?.accountId !== accountId) return false;
      rows.delete(key(issuer, subject));
      return true;
    },
    async list(accountId) {
      return [...rows.values()].filter((r) => r.accountId === accountId).sort((a, b) => compareAsc(a.linkedAt, b.linkedAt)).map(({ issuer, subject, linkedAt }) => ({ issuer, subject, linkedAt }));
    },
  };
}

/**
 * The table of links (idempotent). `accounts` is the product's account table.
 * @deprecated Use `identityLinksSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`. Removed in the next major.
 */
export function identityLinksMigration(): string {
  return identityLinksSchema.migrations[0]!.sql({ schema: "public", tables: { accounts: "accounts" } });
}

/** The store over the product's own database (`external_identities`; see `identityLinksMigration`). */
export function dbIdentityLinks(query: Query): IdentityLinkStore {
  return {
    async find(issuer, subject) {
      const [row] = await query<{ account_id: string }>("SELECT account_id FROM external_identities WHERE issuer = $1 AND subject = $2", [issuer, subject]);
      return row?.account_id ?? null;
    },
    async link(accountId, issuer, subject, now) {
      // One statement: the primary key decides a race; the same account is a no-op, another account is refused.
      const rows = await query<{ account_id: string }>(
        `INSERT INTO external_identities (issuer, subject, account_id, linked_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (issuer, subject) DO UPDATE SET issuer = excluded.issuer WHERE external_identities.account_id = excluded.account_id
         RETURNING account_id`,
        [issuer, subject, accountId, now],
      );
      if (rows.length === 0) throw new IdentityLinkError();
    },
    async unlink(accountId, issuer, subject) {
      const rows = await query("DELETE FROM external_identities WHERE issuer = $1 AND subject = $2 AND account_id = $3 RETURNING 1", [issuer, subject, accountId]);
      return rows.length > 0;
    },
    async list(accountId) {
      const rows = await query<{ issuer: string; subject: string; linked_at: Date }>("SELECT issuer, subject, linked_at FROM external_identities WHERE account_id = $1 ORDER BY linked_at, issuer, subject", [accountId]);
      return rows.map((r) => ({ issuer: r.issuer, subject: r.subject, linkedAt: r.linked_at }));
    },
  };
}
