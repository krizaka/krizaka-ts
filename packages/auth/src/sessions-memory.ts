import type { NewSession, Session, SessionStore } from "./sessions";

/**
 * An in-memory session store, for unit tests and demos. `accountOf` plays the accounts table: it answers the account of an id, or null
 * when it does not exist or is not active.
 */
export function memorySessionStore<Account>(accountOf: (accountId: string) => Account | null): SessionStore<Account> & { rows(): readonly NewSession[] } {
  const rows = new Map<string, NewSession & { id: string }>();
  let next = 0;
  return {
    async insert(session) {
      if (rows.has(session.tokenHash)) throw new Error("duplicate session token hash");
      next += 1;
      rows.set(session.tokenHash, { ...session, id: `session-${next}` });
    },
    async find(tokenHash, now): Promise<Session<Account> | null> {
      const row = rows.get(tokenHash);
      if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
      const account = accountOf(row.accountId);
      return account === null ? null : { id: row.id, account };
    },
    async delete(tokenHash) {
      rows.delete(tokenHash);
    },
    rows: () => [...rows.values()],
  };
}
